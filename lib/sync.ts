import { getTargetRaceDates } from "./date";
import { syncDiscordMemos } from "./discord";
import { matchRacesToMemos } from "./match";
import { getRaceResults, getRaces } from "./races";
import {
  discordStorePath,
  raceStorePath,
  readJson,
  snapshotPath,
  writeJson,
} from "./storage";
import type { DiscordMemoStore, PublishedSnapshot, Race, RaceStore } from "./types";

export type SyncScope = "all" | "discord" | "races" | "today" | "results";

function ymdInJst(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function weekdayInJst(now: Date) {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).getUTCDay();
}

export function mergeRaces(previous: Race[], incoming: Race[], successfulDates: string[], failedRaceIds: string[] = []) {
  const replaceDates = new Set(successfulDates);
  return [
    ...previous.filter((race) => !replaceDates.has(race.date) || failedRaceIds.includes(`${race.date}:${race.raceId}`)),
    ...incoming,
  ].sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue, "ja") || a.raceNumber - b.raceNumber);
}

function makeSnapshot(
  weekStart: string,
  dates: string[],
  raceStore: RaceStore,
  discordStore: DiscordMemoStore | undefined,
  options: {
    discordErrors?: string[];
    additionalErrors?: string[];
    discordMode?: "initial" | "incremental" | "cached";
    discordFetchedCount?: number;
    externalRequestCount?: number;
  } = {},
): PublishedSnapshot {
  const memos = discordStore?.memos || [];
  return {
    version: 1,
    weekStart,
    dates,
    raceDates: dates.filter((date) => raceStore.races.some((race) => race.date === date)),
    matches: matchRacesToMemos(raceStore.races, memos),
    diagnostics: {
      raceSource: raceStore.source,
      raceDates: dates,
      raceCount: raceStore.races.length,
      runnerCount: raceStore.races.reduce((sum, race) => sum + race.horses.length, 0),
      discordChannelCount: Object.keys(discordStore?.channels || {}).length,
      discordMessageCount: memos.length,
      errors: [...raceStore.errors, ...(options.discordErrors || []), ...(options.additionalErrors || [])],
      generatedAt: new Date().toISOString(),
      discordSyncMode: options.discordMode || "cached",
      discordFetchedCount: options.discordFetchedCount || 0,
      externalRequestCount: options.externalRequestCount || 0,
    },
  };
}

/** Fetch results for the most recently completed JRA meeting, after it closes. */
export async function syncCompletedMeetingResults(now = new Date(), requestCountBeforeResults = 0) {
  const weekday = weekdayInJst(now);
  if (weekday !== 1 && weekday !== 2) {
    return { ok: true, scope: "results", skipped: "結果更新の対象曜日ではありません。", externalRequestCount: 0, errors: [] as string[] };
  }

  const dates = getTargetRaceDates(now, weekday === 2 ? "last" : "current");
  const weekStart = dates[0];
  const oldRaces = await readJson<RaceStore>(raceStorePath(weekStart), true);
  if (!oldRaces) {
    return { ok: true, scope: "results", weekStart, skipped: "保存済みの出走データがありません。", externalRequestCount: 0, errors: [] as string[] };
  }

  // A Monday holiday can be the third day of the meeting. Wait until Tuesday
  // so the result view is published only after the complete meeting has ended.
  const mondayScheduleUncertain = weekday === 1 && oldRaces.value.errors.some((error) => error.startsWith(`${dates[2]}:`));
  if (weekday === 1 && (
    oldRaces.value.races.some((race) => race.date === dates[2]) || mondayScheduleUncertain
  )) {
    return { ok: true, scope: "results", weekStart, skipped: "月曜開催があるため、火曜の結果更新まで保留します。", externalRequestCount: 0, errors: [] as string[] };
  }

  const oldDiscord = await readJson<DiscordMemoStore>(discordStorePath(), true);
  const memoMatches = matchRacesToMemos(oldRaces.value.races, oldDiscord?.value.memos || []);
  const matchedByRace = new Map<string, Set<string>>();
  for (const match of memoMatches) {
    if (!dates.slice(0, 2 + (weekday === 2 ? 1 : 0)).includes(match.date) || match.finishPosition) continue;
    if (!matchedByRace.has(match.raceId)) matchedByRace.set(match.raceId, new Set());
    matchedByRace.get(match.raceId)!.add(match.horseName);
  }

  const targetDates = new Set(dates.slice(0, 2 + (weekday === 2 ? 1 : 0)));
  const targetRaces = oldRaces.value.races.filter((race) => targetDates.has(race.date) && matchedByRace.has(race.raceId));
  if (!targetRaces.length) {
    return { ok: true, scope: "results", weekStart, matchedRaceCount: 0, externalRequestCount: 0, errors: [] as string[] };
  }

  const result = await getRaceResults(targetRaces);
  const races = oldRaces.value.races.map((race) => {
    const byHorse = result.positions[race.raceId];
    const names = matchedByRace.get(race.raceId);
    if (!byHorse || !names) return race;
    return {
      ...race,
      horses: race.horses.map((horse) => names.has(horse.name) && byHorse[horse.name]
        ? { ...horse, finishPosition: byHorse[horse.name] }
        : horse),
    };
  });
  const raceStore: RaceStore = {
    ...oldRaces.value,
    updatedAt: new Date().toISOString(),
    races,
    externalRequestCount: result.externalRequestCount,
  };
  await writeJson(raceStorePath(weekStart), raceStore, oldRaces.etag);

  const snapshot = makeSnapshot(weekStart, dates, raceStore, oldDiscord?.value, {
    additionalErrors: result.errors,
    externalRequestCount: requestCountBeforeResults + result.externalRequestCount,
  });
  const oldSnapshot = await readJson<PublishedSnapshot>(snapshotPath(weekStart), true);
  await writeJson(snapshotPath(weekStart), snapshot, oldSnapshot?.etag);

  return {
    ok: true,
    scope: "results",
    weekStart,
    matchedRaceCount: targetRaces.length,
    updatedHorseCount: [...matchedByRace].reduce((count, [raceId, names]) => count
      + [...names].filter((name) => Boolean(result.positions[raceId]?.[name])).length, 0),
    externalRequestCount: result.externalRequestCount,
    errors: result.errors,
    generatedAt: snapshot.diagnostics.generatedAt,
  };
}

async function backfillPreviousWeek(discordStore: DiscordMemoStore | undefined, now: Date) {
  const dates = getTargetRaceDates(now, "last");
  const weekStart = dates[0];
  const existingSnapshot = await readJson<PublishedSnapshot>(snapshotPath(weekStart), true);
  if (existingSnapshot) return { externalRequestCount: 0 };

  const oldRaces = await readJson<RaceStore>(raceStorePath(weekStart), true);
  const result = await getRaces(dates);
  if (!result.successfulDates.length) {
    return { externalRequestCount: result.externalRequestCount };
  }

  const raceStore: RaceStore = {
    version: 1,
    weekStart,
    updatedAt: new Date().toISOString(),
    races: mergeRaces(oldRaces?.value.races || [], result.races, result.successfulDates, result.failedRaceIds),
    errors: result.errors,
    source: result.source,
    externalRequestCount: result.externalRequestCount,
  };
  await writeJson(raceStorePath(weekStart), raceStore, oldRaces?.etag);
  const snapshot = makeSnapshot(weekStart, dates, raceStore, discordStore, {
    externalRequestCount: result.externalRequestCount,
  });
  await writeJson(snapshotPath(weekStart), snapshot);
  return { externalRequestCount: result.externalRequestCount, weekStart };
}

export async function syncPublishedData(scope: SyncScope = "all", now = new Date()) {
  if (scope === "results") return syncCompletedMeetingResults(now);

  const dates = getTargetRaceDates(now, "current");
  const weekStart = dates[0];
  const oldDiscord = await readJson<DiscordMemoStore>(discordStorePath(), true);
  const oldRaces = await readJson<RaceStore>(raceStorePath(weekStart), true);

  let discordStore = oldDiscord?.value;
  let discordErrors: string[] = [];
  let discordMode: "initial" | "incremental" | "cached" = "cached";
  let discordFetchedCount = 0;
  let externalRequestCount = 0;

  if (scope === "all" || scope === "discord") {
    const result = await syncDiscordMemos(discordStore);
    discordErrors = result.errors;
    discordMode = result.mode;
    discordFetchedCount = result.fetchedCount;
    externalRequestCount += result.externalRequestCount;
    if (result.store) {
      discordStore = result.store;
      await writeJson(discordStorePath(), result.store, oldDiscord?.etag);
    }
  }

  let raceStore = oldRaces?.value;
  if (!raceStore) {
    raceStore = {
      version: 1,
      weekStart,
      updatedAt: now.toISOString(),
      races: [],
      errors: [],
      source: (process.env.RACE_SOURCE || "netkeiba").toLowerCase(),
      externalRequestCount: 0,
    };
  }

  if (scope === "all" || scope === "races" || scope === "today") {
    const today = ymdInJst(now);
    const refreshDates = scope === "today"
      ? (dates.includes(today) ? [today] : [])
      : dates;
    const result = await getRaces(refreshDates);
    externalRequestCount += result.externalRequestCount;
    raceStore = {
      version: 1,
      weekStart,
      updatedAt: new Date().toISOString(),
      races: mergeRaces(raceStore.races, result.races, result.successfulDates, result.failedRaceIds),
      errors: result.errors,
      source: result.source,
      externalRequestCount: result.externalRequestCount,
    };
    await writeJson(raceStorePath(weekStart), raceStore, oldRaces?.etag);
  }

  const snapshot = makeSnapshot(weekStart, dates, raceStore, discordStore, {
    discordErrors,
    discordMode,
    discordFetchedCount,
    externalRequestCount,
  });

  const oldSnapshot = await readJson<PublishedSnapshot>(snapshotPath(weekStart), true);
  await writeJson(snapshotPath(weekStart), snapshot, oldSnapshot?.etag);

  const meetingResults = scope === "today" && weekdayInJst(now) === 1
    ? await syncCompletedMeetingResults(now, externalRequestCount)
    : null;
  if (meetingResults) externalRequestCount += meetingResults.externalRequestCount || 0;

  const backfill = scope === "all"
    ? await backfillPreviousWeek(discordStore, now)
    : { externalRequestCount: 0 };
  externalRequestCount += backfill.externalRequestCount;

  return {
    ok: true,
    scope,
    weekStart,
    raceCount: snapshot.diagnostics.raceCount,
    runnerCount: snapshot.diagnostics.runnerCount,
    memoCount: snapshot.diagnostics.discordMessageCount,
    matchedHorseCount: new Set(snapshot.matches.map((m) => `${m.date}:${m.raceId}:${m.horseName}`)).size,
    discordMode,
    discordFetchedCount,
    externalRequestCount,
    backfilledWeekStart: "weekStart" in backfill ? backfill.weekStart : undefined,
    errors: [...snapshot.diagnostics.errors, ...(meetingResults?.errors || [])],
    generatedAt: snapshot.diagnostics.generatedAt,
  };
}

