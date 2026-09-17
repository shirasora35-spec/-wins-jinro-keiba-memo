import { getTargetRaceDates } from "./date";
import { syncDiscordMemos } from "./discord";
import { matchRacesToMemos } from "./match";
import { getRaces } from "./races";
import {
  discordStorePath,
  raceStorePath,
  readJson,
  snapshotPath,
  writeJson,
} from "./storage";
import type { DiscordMemoStore, PublishedSnapshot, Race, RaceStore } from "./types";

export type SyncScope = "all" | "discord" | "races" | "today";

function ymdInJst(now: Date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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
      errors: [...raceStore.errors, ...(options.discordErrors || [])],
      generatedAt: new Date().toISOString(),
      discordSyncMode: options.discordMode || "cached",
      discordFetchedCount: options.discordFetchedCount || 0,
      externalRequestCount: options.externalRequestCount || 0,
    },
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
    const refreshDates = scope === "today" && dates.includes(today) ? [today] : dates;
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
    errors: snapshot.diagnostics.errors,
    generatedAt: snapshot.diagnostics.generatedAt,
  };
}
