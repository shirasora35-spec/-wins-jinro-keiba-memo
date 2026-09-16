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

function mergeRaces(previous: Race[], incoming: Race[], refreshedDates: string[]) {
  const incomingDates = new Set(incoming.map((race) => race.date));
  const replaceDates = new Set(refreshedDates.filter((date) => incomingDates.has(date)));
  return [
    ...previous.filter((race) => !replaceDates.has(race.date)),
    ...incoming,
  ].sort((a, b) => a.date.localeCompare(b.date) || a.venue.localeCompare(b.venue, "ja") || a.raceNumber - b.raceNumber);
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
      races: mergeRaces(raceStore.races, result.races, refreshDates),
      errors: result.errors,
      source: result.source,
      externalRequestCount: result.externalRequestCount,
    };
    await writeJson(raceStorePath(weekStart), raceStore, oldRaces?.etag);
  }

  const memos = discordStore?.memos || [];
  const matches = matchRacesToMemos(raceStore.races, memos);
  const raceDates = dates.filter((date) => raceStore.races.some((race) => race.date === date));
  const snapshot: PublishedSnapshot = {
    version: 1,
    weekStart,
    dates,
    raceDates,
    matches,
    diagnostics: {
      raceSource: raceStore.source,
      raceDates: dates,
      raceCount: raceStore.races.length,
      runnerCount: raceStore.races.reduce((sum, race) => sum + race.horses.length, 0),
      discordChannelCount: Object.keys(discordStore?.channels || {}).length,
      discordMessageCount: memos.length,
      errors: [...raceStore.errors, ...discordErrors],
      generatedAt: new Date().toISOString(),
      discordSyncMode: discordMode,
      discordFetchedCount,
      externalRequestCount,
    },
  };

  const oldSnapshot = await readJson<PublishedSnapshot>(snapshotPath(weekStart), true);
  await writeJson(snapshotPath(weekStart), snapshot, oldSnapshot?.etag);

  return {
    ok: true,
    scope,
    weekStart,
    raceCount: snapshot.diagnostics.raceCount,
    runnerCount: snapshot.diagnostics.runnerCount,
    memoCount: snapshot.diagnostics.discordMessageCount,
    matchedHorseCount: new Set(matches.map((m) => `${m.date}:${m.raceId}:${m.horseName}`)).size,
    discordMode,
    discordFetchedCount,
    externalRequestCount,
    errors: snapshot.diagnostics.errors,
    generatedAt: snapshot.diagnostics.generatedAt,
  };
}
