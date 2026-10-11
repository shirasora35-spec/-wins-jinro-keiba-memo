import type { AxisEvidence, HorseEvidence, StrengthReport } from "../lib/strength";
import styles from "../app/strength/strength.module.css";

const axes = [
  { key: "clock", label: "補正時計", description: "条件差を補正した走破時計の根拠" },
  { key: "pace", label: "前方・持続ペース", description: "厳しい持続ラップのレースで前方を維持した根拠" },
  { key: "acceleration", label: "加速ラップの勝利", description: "終盤が加速するレースで勝利した根拠" },
] as const;

export type StrengthAxisFilter = "all" | typeof axes[number]["key"];

export function parseStrengthAxis(value: string | string[] | undefined): StrengthAxisFilter {
  return typeof value === "string" && axes.some((axis) => axis.key === value)
    ? value as StrengthAxisFilter
    : "all";
}

const stateLabels: Record<AxisEvidence["state"], string> = {
  supported: "根拠あり",
  reference: "参考情報",
  unassessed: "未評価・データ不足",
  "not-observed": "対象条件の確認なし",
};

function EvidenceAxis({ axis, evidence }: {
  axis: typeof axes[number];
  evidence: AxisEvidence;
}) {
  return (
    <section className={styles.axis} aria-label={axis.label}>
      <div className={styles.axisHeading}>
        <h3>{axis.label}</h3>
        <span className={styles.state} data-state={evidence.state}>{stateLabels[evidence.state]}</span>
      </div>
      <p className={styles.summary}>{evidence.summary}</p>
      {evidence.details.length > 0 ? (
        <details className={styles.details}>
          <summary>判定の根拠を見る</summary>
          <ul>{evidence.details.map((detail, index) => <li key={index}>{detail}</li>)}</ul>
        </details>
      ) : <p className={styles.noDetails}>追加の根拠データはありません。</p>}
    </section>
  );
}

function HorseCard({ horse, filter }: { horse: HorseEvidence; filter: StrengthAxisFilter }) {
  return (
    <article className={styles.card}>
      <header className={styles.cardHeader}>
        <p className={styles.raceMeta}><time dateTime={horse.raceDate}>{horse.raceDate}</time> · {horse.venue} · {horse.raceName}</p>
        <h2>{horse.horseName}</h2>
        <p className={styles.recordScope}>このレースで確認できた根拠</p>
      </header>
      <div className={styles.axisList}>
        {axes.filter((axis) => filter === "all" || filter === axis.key).map((axis) => (
          <EvidenceAxis key={axis.key} axis={axis} evidence={horse[axis.key]} />
        ))}
      </div>
    </article>
  );
}

function formatAsOf(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更新日時を確認できません";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date) + " JST";
}

function safeSourceUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function StrengthReportView({ report, filter = "all" }: {
  report: StrengthReport | null;
  filter?: StrengthAxisFilter;
}) {
  const sourceUrl = report ? safeSourceUrl(report.sourceUrl) : undefined;
  return (
    <main className={styles.page}>
      <header className={styles.hero}>
        <p className={styles.eyebrow}>WINS 人狼 · レースの根拠</p>
        <h1>強さを、3つの軸で見る</h1>
        <p className={styles.intro}>時計、持続ペース、終盤の加速。それぞれの根拠を分けて確認します。総合点や馬の順位にはまとめません。</p>
      </header>

      <section className={styles.guide} aria-labelledby="strength-guide-title">
        <h2 id="strength-guide-title">この評価の読み方</h2>
        <ul>
          <li>レースラップは各地点の先頭馬を基準にした区間時計です。同じ馬の個別ラップとは限りません。</li>
          <li>通過順位だけでは、その馬が厳しい負荷を受けたと断定できません。</li>
          <li>「未評価・データ不足」は判定材料の不足、「対象条件の確認なし」はその条件の根拠が確認されなかった状態です。どちらも「弱い」という評価ではありません。</li>
        </ul>
      </section>

      {report && (
        <div className={styles.provenance}>
          <p>出典：{sourceUrl ? <a href={sourceUrl} rel="noreferrer">{report.sourceLabel}</a> : report.sourceLabel}</p>
          <p>集計時点：<time dateTime={report.generatedAt}>{formatAsOf(report.generatedAt)}</time></p>
        </div>
      )}

      {!report || report.horses.length === 0 ? (
        <section className={styles.empty} aria-labelledby="strength-empty-title">
          <span className={styles.emptyMark} aria-hidden="true">—</span>
          <h2 id="strength-empty-title">公開できる評価データはまだありません</h2>
          <p>出典と利用条件を確認し、評価に必要なデータがそろってから表示します。データがないことは、馬の能力が低いことを意味しません。</p>
        </section>
      ) : (
        <>
          <nav className={styles.filters} aria-label="表示する評価軸">
            <a href="/strength" aria-current={filter === "all" ? "page" : undefined}>3軸すべて</a>
            {axes.map((axis) => (
              <a key={axis.key} href={`/strength?axis=${axis.key}`} aria-current={filter === axis.key ? "page" : undefined}>{axis.label}</a>
            ))}
          </nav>
          <p className={styles.resultCount}>{report.horses.length}件のレース別記録 · {filter === "all" ? "3つの根拠を並列表示" : axes.find((axis) => axis.key === filter)?.description}</p>
          <div className={styles.cards}>
            {report.horses.map((horse, index) => <HorseCard key={`${horse.raceId}:${horse.horseId}:${index}`} horse={horse} filter={filter} />)}
          </div>
        </>
      )}
      <footer className={styles.footer}>過去のレースで確認できた根拠を示すもので、次走の結果を保証するものではありません。</footer>
    </main>
  );
}

export default StrengthReportView;
