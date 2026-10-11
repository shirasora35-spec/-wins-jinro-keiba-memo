import { unstable_cache } from 'next/cache';
import { readJson } from './storage';
import { prepareStrengthReport } from './strength-import';
import type { StrengthReport } from './strength';
export const strengthInputPath = 'keiba-cache/strength/approved-input.json';
/** Only this route reads strength data. Existing memo snapshots and cron are untouched. */
export const getStrengthReport = unstable_cache(async (): Promise<StrengthReport | null> => {
  const saved = await readJson<unknown>(strengthInputPath);
  if (!saved) return null;
  // Fail closed for missing provenance or invalid payloads. Never publish partial evaluations.
  return prepareStrengthReport(saved.value);
}, ['strength-report-v1'], { revalidate: 60 });
