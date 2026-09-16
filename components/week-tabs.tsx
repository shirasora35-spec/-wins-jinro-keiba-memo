"use client";

import { useMemo, useState } from "react";
import type { Diagnostics, MatchedHorse } from "../lib/types";
import { formatJapaneseDate, formatJstTimestamp } from "../lib/date";

function DayPanel({ date, horses }: { date: string; horses: MatchedHorse[] }) {
  const grouped = useMemo(() => {
    const map = new Map<string, MatchedHorse[]>();
    for (const horse of horses) {
      const key = `${horse.venue}__${horse.raceNumber}__${horse.raceName}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(horse);
    }
    return [...map.entries()];
  }, [horses]);

  if (!horses.length) {
    return (
      <div className="empty-state">
        <div className="empty-icon">◎</div>
        <h2>この日のメモ馬はありません</h2>
        <p>出走馬とDiscordメモの馬名が一致すると、ここに自動表示されます。</p>
      </div>
    );
  }

  return (
    <div className="race-list">
      {grouped.map(([key, raceHorses]) => {
        const race = raceHorses[0];
        return (
          <section className="race-card" key={key}>
            <div className="race-heading">
              <div>
                <span className="venue-badge">{race.venue}</span>
                <strong>{race.raceNumber}R</strong>
              </div>
              <div className="race-name">{race.raceName}</div>
            </div>

            <div className="horse-list">
              {raceHorses.map((horse) => (
                <article className="horse-card" key={`${horse.raceId}-${horse.horseName}`}>
                  <div className="horse-title-row">
                    {horse.horseNumber ? <span className="horse-number">{horse.horseNumber}</span> : null}
                    <h3>{horse.horseName}</h3>
                    <span className="memo-count">メモ {horse.memos.length}件</span>
                  </div>

                  <div className="memo-stack">
                    {horse.memos.map((memo) => (
                      <details className="memo-card" open={horse.memos.length === 1} key={memo.messageId}>
                        <summary>
                          <span>{formatJstTimestamp(memo.timestamp)}</span>
                          <span className="channel-chip">#{memo.channelName}</span>
                        </summary>
                        <div className="memo-body">
                          <pre>{memo.excerpt}</pre>
                          <div className="memo-meta">
                            <span>投稿者: {memo.authorName}</span>
                            {memo.messageUrl ? (
                              <a href={memo.messageUrl} target="_blank" rel="noreferrer">
                                Discordで元メモを見る ↗
                              </a>
                            ) : null}
                          </div>
                        </div>
                      </details>
                    ))}
                  </div>

                  {horse.raceUrl ? (
                    <a className="race-link" href={horse.raceUrl} target="_blank" rel="noreferrer">
                      出馬表を確認 ↗
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export default function WeekTabs({
  dates,
  raceDates,
  matches,
  diagnostics,
}: {
  dates: string[];
  raceDates: string[];
  matches: MatchedHorse[];
  diagnostics: Diagnostics;
}) {
  // Show every day that actually has JRA races, even when there are no memo horses.
  // This makes three-day meetings (Sat/Sun/Mon) appear correctly while ordinary
  // two-day weekends remain Sat/Sun only. If race data cannot be obtained at all,
  // fall back to Sat/Sun so the page still has a usable tab layout.
  const tabs = raceDates.length ? raceDates : dates.slice(0, 2);
  const [active, setActive] = useState(tabs[0] || dates[0]);
  const todayMatches = matches.filter((m) => m.date === active);

  return (
    <>
      <div className={tabs.length >= 3 ? "tabs three-days" : "tabs"} role="tablist" aria-label="開催日">
        {tabs.map((date) => {
          const count = matches.filter((m) => m.date === date).length;
          return (
            <button
              key={date}
              type="button"
              role="tab"
              aria-selected={active === date}
              className={active === date ? "tab active" : "tab"}
              onClick={() => setActive(date)}
            >
              <span>{formatJapaneseDate(date)}</span>
              <b>{count}頭</b>
            </button>
          );
        })}
      </div>

      <DayPanel date={active} horses={todayMatches} />

      <details className="diagnostics">
        <summary>取得状況・トラブル確認</summary>
        <dl>
          <div><dt>出走データ</dt><dd>{diagnostics.raceSource}</dd></div>
          <div><dt>取得レース</dt><dd>{diagnostics.raceCount}R / {diagnostics.runnerCount}頭</dd></div>
          <div><dt>Discord</dt><dd>{diagnostics.discordChannelCount}ch / {diagnostics.discordMessageCount}メッセージ</dd></div>
          <div><dt>更新</dt><dd>{formatJstTimestamp(diagnostics.generatedAt)}</dd></div>
          <div><dt>表示方式</dt><dd>保存済みデータ（閲覧時の外部取得なし）</dd></div>
        </dl>
        {diagnostics.errors.length ? (
          <div className="error-box">
            {diagnostics.errors.map((error) => <p key={error}>{error}</p>)}
          </div>
        ) : <p className="ok-text">取得エラーはありません。</p>}
      </details>
    </>
  );
}
