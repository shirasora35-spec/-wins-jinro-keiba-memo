import { Suspense } from "react";
import PublishedPage, { PublishedView } from "../components/published-page";
import { getTargetRaceDates } from "../lib/date";
import { getPublishedSnapshot } from "../lib/published";
import { getSyncStatus } from "../lib/sync-status";
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
  const lastWeekStart = getTargetRaceDates(now, "last")[0];
  const [currentSaved, syncStatus] = await Promise.all([
    getPublishedSnapshot(currentDates[0]),
    getSyncStatus(),
  ]);

  const current = currentSaved || emptySnapshot(currentDates);

  return (
    <Suspense fallback={<PublishedView snapshot={current} isLastWeek={false} syncStatus={syncStatus} monitorNow={now.toISOString()} />}>
      <PublishedPage
        current={current}
        lastWeekStart={lastWeekStart}
        syncStatus={syncStatus}
        monitorNow={now.toISOString()}
      />
    </Suspense>
  );
}

