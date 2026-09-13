import WeekTabs from "../components/week-tabs";
import { getTargetRaceDates } from "../lib/date";
import { getDiscordMemos } from "../lib/discord";
import { matchRacesToMemos } from "../lib/match";
import { getRaces } from "../lib/races";
import type { Diagnostics } from "../lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export default async function Home() {
  const dates = getTargetRaceDates();

  const [raceResult, discordResult] = await Promise.all([
    getRaces(dates),
    getDiscordMemos(),
  ]);

  const matches = matchRacesToMemos(raceResult.races, discordResult.memos);
  const uniqueHorses = new Set(matches.map((m) => `${m.date}:${m.raceId}:${m.horseName}`)).size;
  const raceDates = dates.filter((date) => raceResult.races.some((race) => race.date === date));

  const diagnostics: Diagnostics = {
    raceSource: raceResult.source,
    raceDates: dates,
    raceCount: raceResult.races.length,
    runnerCount: raceResult.races.reduce((sum, race) => sum + race.horses.length, 0),
    discordChannelCount: discordResult.channelCount,
    discordMessageCount: discordResult.memos.length,
    errors: [...raceResult.errors, ...discordResult.errors],
    generatedAt: new Date().toISOString(),
  };

  return (
    <main>
      <header className="hero">
        <div className="eyebrow">WINS 人狼</div>
        <h1>競馬メモ</h1>
        <p>Discordの回顧メモから、今週出走する馬だけを自動で掘り起こします。</p>
        <div className="summary-card">
          <span>今週のメモ馬</span>
          <strong>{uniqueHorses}</strong>
          <small>頭</small>
        </div>
      </header>

      <section className="content-shell">
        <WeekTabs dates={dates} raceDates={raceDates} matches={matches} diagnostics={diagnostics} />
      </section>

      <footer>
        <p>出走情報は外部公開情報を取得して照合しています。最終確認は主催者発表をご利用ください。</p>
      </footer>
    </main>
  );
}
