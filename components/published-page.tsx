"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { PublishedSnapshot, SyncStatus } from "../lib/types";
import WeekTabs from "./week-tabs";
import { ReturnToCurrentWeek, WeekLink } from "./week-navigation";

export default function PublishedPage({
  current,
  lastWeekStart,
  syncStatus,
  monitorNow,
}: {
  current: PublishedSnapshot;
  lastWeekStart: string;
  syncStatus: SyncStatus | null;
  monitorNow: string;
}) {
  const searchParams = useSearchParams();
  const isLastWeek = searchParams.get("week") === "last";
  const [last, setLast] = useState<PublishedSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [transferBytes, setTransferBytes] = useState<number | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (!isLastWeek || last) return;
    let active = true;
    const path = `/api/snapshot?weekStart=${encodeURIComponent(lastWeekStart)}`;
    setLoading(true);
    setError("");

    fetch(path)
      .then(async (response) => {
        if (!response.ok) {
          if (response.status === 404) throw new Error("先週の保存データがありません。更新後に再度お試しください。");
          throw new Error(`週データの取得に失敗しました（HTTP ${response.status}）。`);
        }
        return await response.json() as PublishedSnapshot;
      })
      .then((snapshot) => {
        if (!active) return;
        const url = new URL(path, window.location.href).href;
        const entries = performance.getEntriesByName(url) as PerformanceResourceTiming[];
        const resource = entries[entries.length - 1];
        setTransferBytes(resource ? resource.transferSize : null);
        setLast(snapshot);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "週データを取得できませんでした。");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [isLastWeek, last, lastWeekStart, loadAttempt]);

  if (isLastWeek && !last) {
    return (
      <main>
        <ReturnToCurrentWeek />
        <header className="hero">
          <div className="eyebrow">WINS 人狼</div>
          <h1>競馬メモ</h1>
          <p role="status">{loading ? "先週の保存データを読み込み中です。" : error}</p>
          {error && <p><button type="button" className="retry-button" onClick={() => setLoadAttempt((n) => n + 1)}>再読み込み</button></p>}
        </header>
      </main>
    );
  }

  return (
    <PublishedView
      snapshot={isLastWeek ? last! : current}
      isLastWeek={isLastWeek}
      syncStatus={syncStatus}
      monitorNow={monitorNow}
      transferBytes={isLastWeek ? transferBytes : null}
    />
  );
}

export function PublishedView({
  snapshot,
  isLastWeek,
  syncStatus,
  monitorNow,
  transferBytes,
}: {
  snapshot: PublishedSnapshot;
  isLastWeek: boolean;
  syncStatus: SyncStatus | null;
  monitorNow: string;
  transferBytes?: number | null;
}) {
  const dates = snapshot.dates;
  const matches = snapshot.matches;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(monitorNow));
  const isMostRecentCompletedWindow = !isLastWeek
    && snapshot.raceDates.length > 0
    && snapshot.raceDates.every((date) => date < today);
  const uniqueHorses = new Set(matches.map((m) => `${m.date}:${m.raceId}:${m.horseName}`)).size;

  return (
    <main>
      {isLastWeek && <ReturnToCurrentWeek />}
      <header className="hero">
        <div className="eyebrow">WINS 人狼</div>
        <h1>競馬メモ</h1>
        <p>{isLastWeek
          ? "前の週のメモ馬と着順を確認できます。"
          : isMostRecentCompletedWindow
            ? "直近開催のメモ馬と着順を確認できます。"
            : "Discordの回顧メモから、今週出走する馬だけを自動で掘り起こします。"}</p>
        {isLastWeek ? (
          <p role="status">
            先週の開催（{dates[0]} ～ {dates[dates.length - 1]}）
          </p>
        ) : <p className="week-switch"><WeekLink href="/?week=last">前の週のメモ馬と結果を見る ↗</WeekLink></p>}
        <div className="summary-card">
          <span>{isLastWeek ? "前の週のメモ馬" : isMostRecentCompletedWindow ? "直近開催のメモ馬" : "今週のメモ馬"}</span>
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
          isLastWeek={isLastWeek}
          showResultState={isLastWeek || isMostRecentCompletedWindow}
          syncStatus={syncStatus}
          monitorNow={monitorNow}
          transferBytes={transferBytes}
        />
      </section>

      <footer>
        <p>出走情報は外部公開情報を取得して照合しています。最終確認は主催者発表をご利用ください。</p>
      </footer>
    </main>
  );
}

