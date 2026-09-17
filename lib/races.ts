import * as cheerio from "cheerio";
import type { CheerioAPI } from "cheerio";
import { compactDate } from "./date";
import { parseRaceIds } from "./race-list";
import { Race, RaceHorse } from "./types";

const VENUES = ["札幌", "函館", "福島", "新潟", "東京", "中山", "中京", "京都", "阪神", "小倉"];

function headers() {
  return {
    "User-Agent":
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1 WINS-Jinro-Keiba-Memo/1.0",
    "Accept-Language": "ja-JP,ja;q=0.9,en;q=0.6",
  };
}

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function parseNumber(text: string) {
  const m = text.match(/(\d+)\s*R/i);
  return m ? Number(m[1]) : undefined;
}

function fallbackRaceNumber(raceId: string) {
  const n = Number(raceId.slice(-2));
  return Number.isFinite(n) && n >= 1 && n <= 12 ? n : 0;
}

function parseVenueFromText(text: string) {
  return VENUES.find((v) => text.includes(v)) || "JRA";
}

export function extractHorses($: CheerioAPI): RaceHorse[] {
  const horses: RaceHorse[] = [];

  $("tr.HorseList, .HorseList").each((_, row) => {
    const el = $(row);
    const name = clean(el.find(".HorseName, .HorseLink a").first().text());
    if (!name) return;
    const numberText = clean(el.find(".Umaban, .Num, td[class^='Waku']").first().text());
    const numberMatch = numberText.match(/\d+/);
    horses.push({
      name,
      number: numberMatch ? Number(numberMatch[0]) : undefined,
    });
  });

  if (!horses.length) {
    $("table a[href*='/horse/']").each((_, a) => {
      const name = clean($(a).text()).replace(/のデータベース$/, "");
      if (!name || name.length > 30) return;
      const row = $(a).closest("tr");
      const numberText = clean(row.find(".Umaban").first().text());
      const numberMatch = numberText.match(/\d+/);
      horses.push({ name, number: numberMatch ? Number(numberMatch[0]) : undefined });
    });
  }

  const unique = new Map<string, RaceHorse>();
  for (const horse of horses) {
    if (!unique.has(horse.name)) unique.set(horse.name, horse);
  }
  return [...unique.values()];
}

async function fetchHtml(url: string, counter: { value: number }) {
  counter.value++;
  const response = await fetch(url, {
    headers: headers(),
    next: { revalidate: 1800 },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.text();
}

async function fetchNetkeibaDate(date: string, listHtml: string, counter: { value: number }) {
  const compact = compactDate(date);
  const raceIds = parseRaceIds(listHtml, date);
  const failedRaceIds: string[] = [];
  if (!raceIds.length) return { races: [], failedRaceIds };

  const races: Race[] = [];

  // Keep concurrency low to avoid hammering the source.
  for (let i = 0; i < raceIds.length; i += 4) {
    const chunk = raceIds.slice(i, i + 4);
    const results = await Promise.all(
      chunk.map(async (raceId) => {
        const sourceUrl = `https://race.sp.netkeiba.com/race/shutuba.html?race_id=${raceId}`;
        try {
          const html = await fetchHtml(sourceUrl, counter);
          const $ = cheerio.load(html);
          const actualDate = $("[id^='kaisaiDate:']").first().attr("id")?.split(":")[1];
          if (actualDate !== compact) throw new Error("出走表の日付不一致");
          const title = clean($("title").text());
          const headerText = clean($("body").text().slice(0, 2500));
          const raceName =
            clean($(".RaceName, .Race_Name").first().text()) ||
            clean($("h1").first().text()) ||
            "レース名未取得";
          const raceNumText = clean($(".RaceNum, .Race_Num").first().text()) || title;
          const raceNumber = parseNumber(raceNumText) || fallbackRaceNumber(raceId);
          const venue = VENUES[Number(raceId.slice(4, 6)) - 1] || parseVenueFromText(`${title} ${headerText}`);
          const horses = extractHorses($);

          if (!horses.length) throw new Error("出走馬未公開または取得失敗");
          return {
            date,
            venue,
            raceNumber,
            raceName,
            raceId,
            sourceUrl,
            horses,
          } satisfies Race;
        } catch {
          failedRaceIds.push(raceId);
          return null;
        }
      }),
    );
    for (const result of results) if (result) races.push(result);
  }

  races.sort((a, b) => {
    const venueCmp = a.venue.localeCompare(b.venue, "ja");
    return venueCmp || a.raceNumber - b.raceNumber;
  });
  return { races, failedRaceIds };
}

function parseManualRaces(): Race[] {
  const raw = process.env.MANUAL_RACES_JSON?.trim();
  if (!raw) return [];
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter((r) => r && typeof r === "object" && Array.isArray(r.horses))
      .map((r) => ({
        date: String(r.date || ""),
        venue: String(r.venue || "JRA"),
        raceNumber: Number(r.raceNumber || 0),
        raceName: String(r.raceName || ""),
        raceId: String(r.raceId || `manual-${r.date}-${r.venue}-${r.raceNumber}`),
        sourceUrl: r.sourceUrl ? String(r.sourceUrl) : undefined,
        horses: r.horses.map((h: unknown) => {
          if (typeof h === "string") return { name: h };
          const obj = (h || {}) as Record<string, unknown>;
          return {
            name: String(obj.name || ""),
            number: obj.number == null ? undefined : Number(obj.number),
          };
        }).filter((h: RaceHorse) => h.name),
      }));
  } catch {
    return [];
  }
}

export async function getRaces(dates: string[]) {
  const source = (process.env.RACE_SOURCE || "netkeiba").toLowerCase();
  const manual = parseManualRaces();
  const errors: string[] = [];
  const successfulDates: string[] = [];
  const failedRaceIds: string[] = [];
  const counter = { value: 0 };

  if (source === "manual") {
    return { races: manual.filter((r) => dates.includes(r.date)), errors, successfulDates: dates, failedRaceIds, source: "manual", externalRequestCount: 0 };
  }

  const races: Race[] = [];
  let listHtml = "";
  if (dates.length) {
    try {
      // One mobile list contains all Sat/Sun/Mon tabs. Fetch it once per batch.
      listHtml = await fetchHtml(`https://race.sp.netkeiba.com/?pid=race_list&kaisai_date=${compactDate(dates[0])}`, counter);
    } catch {
      errors.push("出走日一覧の取得に失敗しました。前回データを保持します。");
    }
  }
  for (const date of dates) {
    if (!listHtml) break;
    try {
      const result = await fetchNetkeibaDate(date, listHtml, counter);
      races.push(...result.races);
      failedRaceIds.push(...result.failedRaceIds.map((id) => `${date}:${id}`));
      if (result.failedRaceIds.length) errors.push(`${date}: ${result.failedRaceIds.length}レースの出走馬が未公開または取得失敗。前回データがあれば保持します。`);
      successfulDates.push(date);
    } catch {
      errors.push(`${date}: 対象日の一覧を確認できませんでした。前回データを保持します。`);
    }
  }

  if (!races.length && manual.length) {
    return {
      races: manual.filter((r) => dates.includes(r.date)),
      errors: [...errors, "自動取得に失敗したため MANUAL_RACES_JSON を使用しました。"],
      successfulDates: dates,
      failedRaceIds: [],
      source: "manual-fallback",
      externalRequestCount: counter.value,
    };
  }

  return { races, errors, successfulDates, failedRaceIds, source: "netkeiba", externalRequestCount: counter.value };
}
