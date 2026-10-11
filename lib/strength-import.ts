import { evaluateStrength, type EvaluationInput, type StrengthReport } from './strength';
export type ApprovedStrengthInput = EvaluationInput & { version: 1; generatedAt: string; source: { label: string; url: string; synthetic: false; publicationApproved: true; approvalReference: string } };
const fail = (message: string): never => { throw new Error(`Strength import: ${message}`); };
const obj = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : fail('object required');
const text = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 500 ? value : fail('nonempty text up to 500 characters required');
const num = (value: unknown, min = 0) => typeof value === 'number' && Number.isFinite(value) && value > min ? value : fail('positive finite number required');
const integer = (value: unknown, min = 0) => Number.isInteger(num(value,min)) ? value as number : fail('integer required');
const list = (value: unknown, maximum = 10000): any[] => Array.isArray(value) && value.length <= maximum ? value : fail('bounded array required');
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value).toISOString().slice(0,10) === value ? value : fail('ISO date required');
function conditions(value: Record<string, any>) { for (const key of ['venue','course','surface','going','raceClass']) text(value[key]); integer(value.distance); }
function unique(values: string[], label: string) { if (new Set(values).size !== values.length) fail(`duplicate ${label}`); }
/** Manual import boundary, not a license detector: the operator must verify approval first. */
export function validateStrengthInput(value: unknown): ApprovedStrengthInput {
  const v = obj(value);
  if (JSON.stringify(v).length > 2_000_000) fail('payload exceeds 2MB character budget');
  if (v.version !== 1) fail('unsupported version');
  if (typeof v.generatedAt !== 'string' || !Number.isFinite(Date.parse(v.generatedAt))) fail('timestamp required');
  const s = obj(v.source); text(s.label); text(s.approvalReference);
  if (s.synthetic !== false || s.publicationApproved !== true) fail('verified real-data publication approval required; synthetic fixtures cannot be published');
  try { if (new URL(text(s.url)).protocol !== 'https:') fail('HTTPS source required'); } catch { fail('HTTPS source required'); }
  integer(v.correctionMinimumRaces, 1);
  const races = list(v.races, 1000); const baselines = list(v.baselines, 500); const calibrations = list(v.calibrations, 500);
  if (races.reduce((n,r)=>n+list(obj(r).runners,100).length,0)>2000) fail('report exceeds 2000 runners');
  if (baselines.reduce((n,b)=>n+list(obj(b).sampleRaceIds,1000).length,0)>50000) fail('baseline provenance exceeds 50000 IDs');
  unique(races.map(r=>text(obj(r).id)), 'race'); unique(baselines.map(b=>text(obj(b).id)), 'baseline');
  const conditionKey = (c: any) => JSON.stringify([c.venue,c.course,c.surface,c.distance,c.going,c.raceClass]);
  unique(baselines.map(conditionKey), 'baseline conditions'); unique(calibrations.map(conditionKey), 'calibration conditions');
  for (const raw of races) {
    const r = obj(raw); conditions(r); date(r.date); text(r.name); integer(r.fieldSize);
    const runners = list(r.runners, 100); if (runners.length > r.fieldSize) fail('runners exceed field size');
    unique(runners.map(h=>text(obj(h).horseId)), 'horse in race');
    for (const rawRunner of runners) {
      const h = obj(rawRunner); text(h.horseName);
      if (h.seconds !== null) num(h.seconds);
      if (h.finish !== null && integer(h.finish) > r.fieldSize) fail('finish exceeds field size');
      if (h.passages !== null) { const passages = list(h.passages, 20); if (!passages.length) fail('empty passages must be null'); for (const p of passages) if (integer(p)>r.fieldSize) fail('passage exceeds field size'); }
    }
    if (r.sectionals !== null) {
      const laps = list(r.sectionals,100); if (!laps.length) fail('empty sectionals must be null');
      for (const rawLap of laps) { const lap = obj(rawLap); integer(lap.meters); num(lap.seconds); }
      if (laps.reduce((sum,l)=>sum+l.meters,0) !== r.distance) fail('sectional distances must total race distance');
      const winner = runners.find(h=>h.finish===1 && h.seconds !== null);
      if (winner && Math.abs(laps.reduce((sum,l)=>sum+l.seconds,0)-winner.seconds)>0.5) fail('sectional total inconsistent with winner clock');
    }
  }
  for (const raw of baselines) { const b=obj(raw); conditions(b); if(b.statistic !== 'winner-median') fail('baseline must describe winner median clocks'); num(b.seconds); text(b.method); date(b.throughDate); const ids=list(b.sampleRaceIds); if (!ids.length) fail('baseline sample provenance required'); ids.forEach(text); unique(ids,'baseline sample'); for (const id of ids) { const known = races.find(r=>r.id===id); if (known && (known.date > b.throughDate || conditionKey(known)!==conditionKey(b))) fail('baseline sample contradicts known race date or conditions'); } }
  for (const raw of calibrations) { const c=obj(raw); conditions(c); text(c.evidence); num(c.clockAdvantageSeconds); num(c.maxCorrectionSpreadSeconds); const p=obj(c.pace); integer(p.startIndex,-1); integer(p.forwardRank); integer(p.passageCount); const limits=list(p.maxSecondsPer200,100); if(limits.length<2) fail('sustained pace needs at least two consecutive sections'); limits.forEach((n)=>num(n)); }
  return v as ApprovedStrengthInput;
}
export function prepareStrengthReport(value: unknown): StrengthReport {
  const v=validateStrengthInput(value);
  return {version:1, generatedAt:v.generatedAt, sourceLabel:v.source.label, sourceUrl:v.source.url, horses:evaluateStrength(v)};
}
