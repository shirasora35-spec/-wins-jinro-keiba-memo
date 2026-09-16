import WeekTabs from "../components/week-tabs";
import { getTargetRaceDates } from "../lib/date";
import { getPublishedSnapshot } from "../lib/published";
import type { Diagnostics, PublishedSnapshot } from "../lib/types";

export const revalidate = 60;

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const isLastWeek = params.week === "last";
  const dates = getTargetRaceDates(new Date(), isLastWeek ? "last" : "current");
  const saved = await getPublishedSnapshot(dates[0]);
  const snapshot: PublishedSnapshot = saved || {
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
  const matches = snapshot.matches;
  const uniqueHorses = new Set(matches.map((m) => `${m.date}:${m.raceId}:${m.horseName}`)).size;
  const raceDates = snapshot.raceDates;
  const diagnostics: Diagnostics = snapshot.diagnostics;

  return (
    <main>
      <header className="hero">
        <div className="eyebrow">WINS 人狼</div>
        <h1>競馬メモ</h1>
        <p>{isLastWeek
          ? "先週の出走馬とDiscordの過去メモを照合しています。"
          : "Discordの回顧メモから、今週出走する馬だけを自動で掘り起こします。"}</p>
        {isLastWeek && (
          <p role="status">
            先週の開催・テストモード（{dates[0]} ～ {dates[dates.length - 1]}）
            {" · "}<a href="/">今週の開催に戻る</a>
          </p>
        )}
        <div className="summary-card">
          <span>{isLastWeek ? "先週のメモ馬" : "今週のメモ馬"}</span>
          <strong>{uniqueHorses}</strong>
          <small>頭</small>
        </div>
      </header>

      <section className="content-shell">
        <WeekTabs key={dates[0]} dates={dates} raceDates={raceDates} matches={matches} diagnostics={diagnostics} />
      </section>

      <footer>
        <p>出走情報は外部公開情報を取得して照合しています。最終確認は主催者発表をご利用ください。</p>
      </footer>
    </main>
  );
}
