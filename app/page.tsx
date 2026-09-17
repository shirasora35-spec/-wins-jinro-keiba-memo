import { Suspense } from "react";
import PublishedPage from "../components/published-page";
import { getTargetRaceDates } from "../lib/date";
import { getPublishedSnapshot } from "../lib/published";
import type { PublishedSnapshot } from "../lib/types";

export const revalidate = 60;

function emptySnapshot(dates: string[]): PublishedSnapshot {
  return {
    version: 1,
    weekStart: dates[0],
    dates,
    raceDates: [],
    matches: [],
    diagnostics: {
      raceSource: "saved-snapshot",
      raceDates: dates,
      raceCount: 0,
      runnerCount: 0,
      discordChannelCount: 0,
      discordMessageCount: 0,
      errors: ["保存済みデータがまだありません。次回の定期更新後に表示されます。"],
      generatedAt: new Date(0).toISOString(),
      discordSyncMode: "cached",
      externalRequestCount: 0,
    },
  };
}

export default async function Home() {
  const now = new Date();
  const currentDates = getTargetRaceDates(now, "current");
  const lastDates = getTargetRaceDates(now, "last");
  const [currentSaved, lastSaved] = await Promise.all([
    getPublishedSnapshot(currentDates[0]),
    getPublishedSnapshot(lastDates[0]),
  ]);

  return (
    <Suspense fallback={null}>
      <PublishedPage
        current={currentSaved || emptySnapshot(currentDates)}
        last={lastSaved || emptySnapshot(lastDates)}
      />
    </Suspense>
  );
}
