import type { MatchedHorse } from "./types";

/** Scheduled local race time (JST), never inferred from race number or venue. */
export function normalizeStartTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.normalize("NFKC").trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) return undefined;
  return `${match[1].padStart(2, "0")}:${match[2]}`;
}

export function groupHorsesByStartTime(horses: MatchedHorse[]) {
  const races = new Map<string, MatchedHorse[]>();
  for (const horse of horses) {
    const key = `${horse.date}:${horse.raceId || `${horse.venue}:${horse.raceNumber}`}`;
    if (!races.has(key)) races.set(key, []);
    races.get(key)!.push(horse);
  }
  return [...races].map(([key, raceHorses]) => {
    const times = new Set(raceHorses.map(horse => normalizeStartTime(horse.startTime)).filter(Boolean));
    // Conflicting saved times are unknown rather than choosing an invented value.
    const startTime = times.size === 1 ? [...times][0] : undefined;
    return { key, startTime, horses: [...raceHorses].sort((a, b) => (a.horseNumber ?? 999) - (b.horseNumber ?? 999)) };
  }).sort((a, b) => {
    const left = a.horses[0];
    const right = b.horses[0];
    return left.date.localeCompare(right.date)
      || (a.startTime || "99:99").localeCompare(b.startTime || "99:99")
      || left.venue.localeCompare(right.venue, "ja")
      || left.raceNumber - right.raceNumber
      || left.raceId.localeCompare(right.raceId);
  });
}
