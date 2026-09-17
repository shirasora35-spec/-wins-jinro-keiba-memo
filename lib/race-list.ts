import * as cheerio from "cheerio";

export function parseRaceIds(html: string, date: string) {
  const $ = cheerio.load(html);
  const ids = new Set<string>();
  const compact = date.replaceAll("-", "");
  const groups = $(".RaceListDayWrap");
  if (!groups.length) throw new Error("レース一覧構造を確認できませんでした");

  // Mobile netkeiba contains the entire meeting, including hidden day tabs.
  // Never associate all of those IDs with each requested date.
  let sameMeeting = false;
  groups.each((_, group) => {
    const day = $(group).find("[data-kaisaidate]").first().attr("data-kaisaidate");
    if (!day || !/^\d{8}$/.test(day)) return;
    const dayDate = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`;
    const meetingStart = (value: string) => {
      const d = new Date(`${value}T00:00:00Z`);
      const dow = d.getUTCDay();
      return d.getTime() - (dow === 0 ? 1 : dow === 1 ? 2 : dow - 6) * 86400_000;
    };
    sameMeeting ||= meetingStart(dayDate) === meetingStart(date);
    if (day !== compact) return;
    if (!$(group).find(".RaceList_Main_Box a[href*='race_id=']").length) {
      throw new Error("当日のレース一覧が未公開です");
    }
    $(group).find(".RaceList_Main_Box a[href*='race_id=']").each((_, anchor) => {
      const match = ($(anchor).attr("href") || "").match(/[?&]race_id=(\d{12})(?:&|$)/);
      if (!match) return;
      const venue = Number(match[1].slice(4, 6));
      const race = Number(match[1].slice(-2));
      if (venue >= 1 && venue <= 10 && race >= 1 && race <= 12) ids.add(match[1]);
    });
  });
  if (!sameMeeting) throw new Error("対象週のレース一覧を確認できませんでした");
  if (ids.size > 36) throw new Error("当日のレース数が上限を超えました");
  return [...ids].sort();
}
