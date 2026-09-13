import { DiscordMemo, HorseMemo, MatchedHorse, Race } from "./types";

function normalize(value: string) {
  return value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[ \t　]+/g, "")
    .toLowerCase();
}

function cleanHeadingLine(line: string) {
  return line
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/^\s*>+\s*/, "")
    .replace(/^[#*_~`\s]+/, "")
    .replace(/^[\-–—・●○◎◉★☆▲△▽▼▶▷◆◇■□※✓✔☑☐]+\s*/, "")
    .replace(/^\d{1,2}[.)、．]\s*/, "")
    .replace(/^(?:馬名|対象馬|注目馬|回顧馬|メモ馬)\s*[:：]\s*/i, "")
    .replace(/^[【\[（(〈《「『]\s*/, "")
    .replace(/\s*[】\]）)〉》」』]\s*$/, "")
    .trim();
}

/**
 * ユーザーの回顧フォーマット専用。
 * 例: "中山4R 3着コウサイリクリ【B】"
 *     "札幌8R 4着ピエナオルカ"
 *
 * 馬名は「着」の直後から、評価タグ【A-D】または空白まで。
 * ここは今週の出走馬リストとは独立して解析するため、
 * 今週出ない別馬の行も「次の馬の境界」として認識できる。
 */
type StructuredHorseHeader = {
  horseName: string;
  venue?: string;
  raceNumber?: number;
  finish?: number;
  rating?: string;
};

function structuredHorseHeader(line: string): StructuredHorseHeader | undefined {
  const raw = line
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/^\s*>+\s*/, "")
    .replace(/^[#*_~`\s]+/, "")
    .trim();

  // 「中山4R 3着コウサイリクリ【B】」型。
  // venue はJRA場名に固定せず、地方競馬の場名でも動くように広めに取る。
  const match = raw.match(
    /^([^\s\d→▶▷|｜]{1,14})\s*(\d{1,2})R\s*(\d{1,2})着\s*([^\s【】→▶▷|｜]+)\s*(【[A-D]】)?/i,
  );
  if (!match) return undefined;

  const horseName = match[4]?.trim();
  if (!horseName) return undefined;

  return {
    venue: match[1]?.trim(),
    raceNumber: Number(match[2]),
    finish: Number(match[3]),
    horseName,
    rating: match[5]?.trim(),
  };
}

/** 「札幌2R」「阪神9R →前○展開」のようなレース全体メモの開始行。 */
function raceLevelHeader(line: string) {
  const raw = line
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/^\s*>+\s*/, "")
    .replace(/^[#*_~`\s]+/, "")
    .trim();

  // 馬個別行は別判定に回す。
  if (structuredHorseHeader(raw)) return false;
  return /^([^\s\d→▶▷|｜]{1,14})\s*\d{1,2}R(?:\s*$|\s*(?:→|[-:：]))/.test(raw);
}

function sectionBoundary(line: string) {
  const raw = line.normalize("NFKC").trim();
  if (!raw) return false;
  if (/^-{3,}[|｜]?$/.test(raw)) return true;
  if (/^【その他(?:軽い)?メモ】$/.test(raw)) return true;
  if (/^【[A-D]】/.test(raw)) return true; // 冒頭の評価定義など
  if (/^\d{1,2}月\d{1,2}日/.test(raw)) return true;
  return false;
}

function headingHorse(line: string, horseNames: string[]) {
  const cleaned = cleanHeadingLine(line);
  const n = normalize(cleaned);
  if (!n) return undefined;

  const names = [...horseNames].sort((a, b) => normalize(b).length - normalize(a).length);
  for (const horseName of names) {
    const h = normalize(horseName);
    if (n === h) return horseName;
    if (n.startsWith(h)) {
      const rest = cleaned.slice(horseName.length).trimStart();
      if (!rest || /^[:：\-–—|｜/／・,，]/.test(rest)) return horseName;
    }
  }
  return undefined;
}

function exactHorseMention(line: string, horseName: string) {
  const h = normalize(horseName);
  const n = normalize(line);
  if (!n.includes(h)) return false;

  const raw = line.normalize("NFKC");
  const escaped = horseName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}([^\\p{L}\\p{N}]|$)`, "u");
  return re.test(raw) || cleanHeadingLine(line).startsWith(horseName);
}

function trimExcerpt(lines: string[]) {
  const out = [...lines];
  while (out.length && !out[0].trim()) out.shift();
  while (out.length && !out[out.length - 1].trim()) out.pop();
  return out.join("\n").trim().slice(0, 2200);
}

function structuredHorseMatches(headerHorse: string, targetHorse: string) {
  return normalize(headerHorse) === normalize(targetHorse);
}

/**
 * 1 Discord投稿を馬ごとに分割。
 *
 * 優先順位:
 * 1) 「競馬場 + R + 着順 + 馬名」形式（ユーザーの回顧フォーマット）
 * 2) 馬名単独見出し形式
 * 3) 空行ブロック内の完全一致（救済）
 *
 * 重要: 1) の終了位置は「今週出走する馬」ではなく、投稿内の次の馬個別行/レース全体行で切る。
 * そのため、今週出ない別馬のメモが混ざらない。
 */
function splitMessageByHorse(content: string, horseNames: string[]) {
  const lines = content.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const result = new Map<string, string[]>();

  // 1) ユーザーの回顧フォーマットを最優先で解析。
  for (let i = 0; i < lines.length; i++) {
    const header = structuredHorseHeader(lines[i]);
    if (!header) continue;

    const targetHorse = horseNames.find((name) => structuredHorseMatches(header.horseName, name));
    if (!targetHorse) continue;

    let end = i + 1;
    while (end < lines.length) {
      const line = lines[end];
      // 次の馬個別行、次のレース全体行、セクション区切りで終了。
      if (structuredHorseHeader(line) || raceLevelHeader(line) || sectionBoundary(line)) break;
      end++;
    }

    const excerpt = trimExcerpt(lines.slice(i, end));
    if (!excerpt) continue;
    const arr = result.get(targetHorse) || [];
    arr.push(excerpt);
    result.set(targetHorse, arr);
  }

  // 2) 馬名単独見出し形式。
  // structured で取れた馬には重複追加しない。
  const boundaries: Array<{ index: number; horseName: string }> = [];
  lines.forEach((line, index) => {
    if (structuredHorseHeader(line)) return;
    const horseName = headingHorse(line, horseNames);
    if (horseName) boundaries.push({ index, horseName });
  });

  for (let i = 0; i < boundaries.length; i++) {
    const current = boundaries[i];
    if (result.has(current.horseName)) continue;

    let end = boundaries[i + 1]?.index ?? lines.length;
    for (let j = current.index + 1; j < end; j++) {
      if (structuredHorseHeader(lines[j]) || raceLevelHeader(lines[j]) || sectionBoundary(lines[j])) {
        end = j;
        break;
      }
    }

    const excerpt = trimExcerpt(lines.slice(current.index, end));
    if (!excerpt) continue;
    result.set(current.horseName, [excerpt]);
  }

  // 3) 空行ブロック救済。
  const blocks = content
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);

  for (const block of blocks) {
    const mentioned = horseNames.filter((horseName) =>
      block.split("\n").some((line) => exactHorseMention(line, horseName)),
    );
    if (mentioned.length !== 1) continue;

    const horseName = mentioned[0];
    if (result.has(horseName)) continue;
    result.set(horseName, [block.slice(0, 2200)]);
  }

  return result;
}

function toHorseMemo(memo: DiscordMemo, excerpt: string): HorseMemo {
  return {
    messageId: memo.id,
    channelId: memo.channelId,
    channelName: memo.channelName,
    authorName: memo.authorName,
    timestamp: memo.timestamp,
    excerpt,
    originalContent: memo.content,
    messageUrl: memo.messageUrl,
  };
}

export function matchRacesToMemos(races: Race[], memos: DiscordMemo[]): MatchedHorse[] {
  const matches: MatchedHorse[] = [];
  const allHorseNames = [...new Set(races.flatMap((race) => race.horses.map((horse) => horse.name)))];

  const parsedMessages = memos.map((memo) => ({
    memo,
    byHorse: splitMessageByHorse(memo.content, allHorseNames),
  }));

  for (const race of races) {
    for (const horse of race.horses) {
      const horseMemos = parsedMessages
        .flatMap(({ memo, byHorse }) =>
          (byHorse.get(horse.name) || []).map((excerpt) => toHorseMemo(memo, excerpt)),
        )
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      if (!horseMemos.length) continue;

      matches.push({
        date: race.date,
        venue: race.venue,
        raceNumber: race.raceNumber,
        raceName: race.raceName,
        raceId: race.raceId,
        raceUrl: race.sourceUrl,
        horseName: horse.name,
        horseNumber: horse.number,
        memos: horseMemos,
      });
    }
  }

  return matches.sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp) return dateCmp;
    const venueCmp = a.venue.localeCompare(b.venue, "ja");
    if (venueCmp) return venueCmp;
    const raceCmp = a.raceNumber - b.raceNumber;
    if (raceCmp) return raceCmp;
    return (a.horseNumber ?? 999) - (b.horseNumber ?? 999);
  });
}
