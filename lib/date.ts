const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

function dateInJst(now = new Date()) {
  return new Date(now.getTime() + JST_OFFSET_MS);
}

function ymdFromPseudoJst(date: Date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDaysPseudoJst(date: Date, days: number) {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

/**
 * Current JRA weekend in JST.
 * Mon-Fri -> upcoming Sat/Sun/Mon
 * Sat     -> today/Sun/Mon
 * Sun     -> yesterday/today/Mon
 * Mon is included because JRA sometimes has a three-day meeting.
 */
export function getTargetRaceDates(now = new Date(), week: "current" | "last" = "current") {
  const jst = dateInJst(now);
  const dow = jst.getUTCDay();

  let daysUntilSaturday: number;
  if (dow === 6) daysUntilSaturday = 0;
  else if (dow === 0) daysUntilSaturday = -1;
  // Monday can be the third day of a JRA meeting. Keep that meeting visible
  // through Monday; switch to the upcoming weekend from Tuesday onward.
  else if (dow === 1) daysUntilSaturday = -2;
  else daysUntilSaturday = 6 - dow;

  // Keep the existing Sat/Sun/Mon window; test mode moves that entire window back.
  const sat = addDaysPseudoJst(jst, daysUntilSaturday + (week === "last" ? -7 : 0));
  const sun = addDaysPseudoJst(sat, 1);
  const mon = addDaysPseudoJst(sat, 2);

  return [ymdFromPseudoJst(sat), ymdFromPseudoJst(sun), ymdFromPseudoJst(mon)];
}

export function compactDate(ymd: string) {
  return ymd.replaceAll("-", "");
}

export function formatJapaneseDate(ymd: string) {
  const [year, month, day] = ymd.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${month}月${day}日（${weekdays[d.getUTCDay()]}）`;
}

export function formatJstTimestamp(iso: string) {
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}
