/** Source-independent evidence model. No provider fetches or composite ranking. */
export type AxisEvidence = { state: 'supported' | 'reference' | 'unassessed' | 'not-observed'; summary: string; details: string[] };
export type HorseEvidence = { horseId: string; horseName: string; raceId: string; raceDate: string; venue: string; raceName: string; clock: AxisEvidence; pace: AxisEvidence; acceleration: AxisEvidence };
export type StrengthReport = { version: 1; generatedAt: string; sourceLabel: string; sourceUrl: string; horses: HorseEvidence[] };
export type Conditions = { venue: string; course: string; surface: string; distance: number; going: string; raceClass: string };
export type Runner = { horseId: string; horseName: string; finish: number | null; seconds: number | null; passages: number[] | null };
export type ResultRace = Conditions & { id: string; date: string; name: string; fieldSize: number; sectionals: { meters: number; seconds: number }[] | null; runners: Runner[] };
export type Baseline = Conditions & { id: string; seconds: number; sampleRaceIds: string[]; method: string; statistic: 'winner-median'; throughDate: string };
/** Calibration must be independently reviewed for this exact course/conditions. No defaults. */
export type Calibration = Conditions & { evidence: string; clockAdvantageSeconds: number; maxCorrectionSpreadSeconds: number; pace: { startIndex: number; maxSecondsPer200: number[]; forwardRank: number; passageCount: number } };
export type EvaluationInput = { races: ResultRace[]; baselines: Baseline[]; calibrations: Calibration[]; correctionMinimumRaces: number };
const unknown = (summary: string, details: string[] = []): AxisEvidence => ({ state: 'unassessed', summary, details });
const same = (a: Conditions, b: Conditions) => a.venue === b.venue && a.course === b.course && a.surface === b.surface && a.distance === b.distance && a.going === b.going && a.raceClass === b.raceClass;
const baselineFor = (race: ResultRace, baselines: Baseline[]) => baselines.find(b => same(race, b) && b.throughDate < race.date && !b.sampleRaceIds.includes(race.id));
const median = (values: number[]) => { const s = [...values].sort((a,b) => a-b); const i = Math.floor(s.length/2); return s.length % 2 ? s[i] : (s[i-1]+s[i])/2; };
const format = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}秒`;
type Comparison = { id: string; residual: number };
function clock(race: ResultRace, runner: Runner, input: EvaluationInput, comparisons: Comparison[], calibration?: Calibration): AxisEvidence {
  if (runner.seconds === null) return unknown('走破時計が未取得です');
  const baseline = baselineFor(race, input.baselines);
  if (!baseline) return unknown('条件に合う事前基準時計がありません');
  const raw = baseline.seconds - runner.seconds;
  const details = [`基準 ${baseline.seconds.toFixed(2)}秒 / 走破 ${runner.seconds.toFixed(2)}秒 / 未補正の基準差 ${format(raw)}（正は基準より速い）`, `基準: ${baseline.method}・${baseline.sampleRaceIds.length}レース・${baseline.throughDate}まで`];
  if (comparisons.length < input.correctionMinimumRaces) return {state:'reference', summary:'当日補正の比較レースが不足しています', details:[...details, `比較 ${comparisons.length} / 必要 ${input.correctionMinimumRaces}レース。未補正時計は参考値です。`]};
  const correction = median(comparisons.map(c => c.residual));
  const advantage = raw + correction;
  details.push(`当日補正 ${format(correction)}（遅い馬場は正） / 補正後の基準差 ${format(advantage)}`, `評価対象を除いた同日・同コース・同距離・同馬場の${comparisons.length}レース: ${comparisons.map(c=>c.id).join(', ')}`);
  const spread = Math.max(...comparisons.map(c=>c.residual)) - Math.min(...comparisons.map(c=>c.residual));
  details.push(`比較レースの補正幅 ${spread.toFixed(2)}秒（最大−最小）。標本数と条件の偏りに注意してください。`);
  if (calibration && spread > calibration.maxCorrectionSpreadSeconds) return {state:'reference', summary:'当日の比較レース間のばらつきが大きいため参考値です', details};
  if (!calibration) return {state:'reference', summary:'補正時計は参考値（判定基準は未検証）', details};
  details.push(`判定基準 ${calibration.clockAdvantageSeconds.toFixed(2)}秒以上 / 検証根拠: ${calibration.evidence}`);
  return {state: advantage >= calibration.clockAdvantageSeconds ? 'supported':'not-observed', summary: advantage >= calibration.clockAdvantageSeconds ? '補正後も基準時計を上回りました':'今回の時計条件には該当しません', details};
}
function pace(race: ResultRace, runner: Runner, calibration?: Calibration): AxisEvidence {
  const caveat = 'レースラップは先頭基準です。通過順位だけでは先頭との距離差や個体の負荷を確定できません。';
  if (!race.sectionals || !runner.passages) return unknown('ラップまたは通過順位が未取得です', [caveat]);
  const details = [`レースラップ: ${race.sectionals.map(l=>`${l.meters}m ${l.seconds}秒`).join(' / ')}`, `通過順位: ${runner.passages.join(' → ')}`, caveat];
  if (!calibration) return {state:'reference', summary:'コース別の持続ペース判定基準は未検証です', details};
  const p = calibration.pace;
  const window = race.sectionals.slice(p.startIndex, p.startIndex+p.maxSecondsPer200.length);
  if (window.length !== p.maxSecondsPer200.length || runner.passages.length !== p.passageCount) return unknown('判定に必要な区間または通過地点が揃っていません', details);
  const demanding = window.every((l,i) => l.seconds*200/l.meters <= p.maxSecondsPer200[i]);
  const forward = runner.passages.every(rank => rank <= p.forwardRank);
  details.push(`検証根拠: ${calibration.evidence}`, `区間${p.startIndex+1}から${p.maxSecondsPer200.length}区間 / 200m換算上限 ${p.maxSecondsPer200.join(', ')}秒 / 全${p.passageCount}地点で${p.forwardRank}番手以内`);
  return {state: demanding && forward ? 'supported':'not-observed', summary: demanding && forward ? '厳しい持続ペースのレースで前方を維持':'今回の持続ペース・前方条件には該当しません', details};
}
function acceleration(race: ResultRace, runner: Runner): AxisEvidence {
  const caveat = '先頭基準のレースラップであり、この馬自身の加速を示すものではありません。';
  if (runner.finish === null || !race.sectionals || race.sectionals.length < 3) return unknown('着順または終盤ラップが未取得です', [caveat]);
  const last = race.sectionals.slice(-3);
  if (!last.every(s=>s.meters === 200)) return unknown('比較可能な最終3区間（各200m）が揃っていません', [caveat]);
  const accelerating = last[0].seconds > last[1].seconds && last[1].seconds > last[2].seconds;
  const observed = accelerating && runner.finish === 1;
  return {state:observed?'supported':'not-observed', summary:observed?'最終3区間が加速したレースの勝ち馬':'今回の終盤加速・勝利条件には該当しません', details:[`最後の600m: ${last.map(s=>s.seconds.toFixed(1)).join(' → ')}秒 / ${runner.finish}着`, '定義: 最終3区間（各200m）が連続して短縮。', caveat]};
}
export function evaluateStrength(input: EvaluationInput): HorseEvidence[] {
  // Reuse race-level comparison cohorts for every runner. Exact condition indexes avoid
  // repeatedly scanning all baselines and calibration records in the runner loop.
  const key = (c: Conditions) => JSON.stringify([c.venue,c.course,c.surface,c.distance,c.going,c.raceClass]);
  const dayKey = (r: ResultRace) => JSON.stringify([r.date,r.venue,r.course,r.surface,r.distance,r.going]);
  const baselineIndex = new Map(input.baselines.map(b => [key(b), b]));
  const calibrationIndex = new Map(input.calibrations.map(c => [key(c), c]));
  const groups = new Map<string, Comparison[]>();
  for (const race of input.races) {
    const b = baselineIndex.get(key(race));
    const winner = race.runners.find(h=>h.finish === 1 && h.seconds !== null);
    if (b && winner && baselineFor(race, [b])) {
      const group = groups.get(dayKey(race)) || [];
      group.push({ id:race.id, residual:winner.seconds! - b.seconds });
      groups.set(dayKey(race), group);
    }
  }
  return input.races.flatMap(race => {
    const calibration = calibrationIndex.get(key(race));
    const b = baselineIndex.get(key(race));
    const raceInput = { ...input, baselines:b ? [b] : [] };
    const comparisons = (groups.get(dayKey(race)) || []).filter(c=>c.id !== race.id);
    return race.runners.map(runner => ({horseId:runner.horseId, horseName:runner.horseName, raceId:race.id, raceDate:race.date, venue:race.venue, raceName:race.name, clock:clock(race,runner,raceInput,comparisons,calibration), pace:pace(race,runner,calibration), acceleration:acceleration(race,runner)}));
  });
}
