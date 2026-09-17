"use client";

import { useSearchParams } from "next/navigation";
import type { PublishedSnapshot } from "../lib/types";
import WeekTabs from "./week-tabs";

export default function PublishedPage({
  current,
  last,
}: {
  current: PublishedSnapshot;
  last: PublishedSnapshot;
}) {
  const searchParams = useSearchParams();
  const isLastWeek = searchParams.get("week") === "last";
  const snapshot = isLastWeek ? last : current;
  const dates = snapshot.dates;
  const matches = snapshot.matches;
  const uniqueHorses = new Set(matches.map((m) => `${m.date}:${m.raceId}:${m.horseName}`)).size;

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
        <WeekTabs
          key={snapshot.weekStart}
          dates={dates}
          raceDates={snapshot.raceDates}
          matches={matches}
          diagnostics={snapshot.diagnostics}
        />
      </section>

      <footer>
        <p>出走情報は外部公開情報を取得して照合しています。最終確認は主催者発表をご利用ください。</p>
      </footer>
    </main>
  );
}
