import type { DiscordChannelState, DiscordMemo, DiscordMemoStore } from "./types";

type DiscordRawMessage = {
  id: string;
  content: string;
  timestamp: string;
  guild_id?: string;
  author?: {
    username?: string;
    global_name?: string | null;
  };
};

type DiscordChannel = {
  id: string;
  name?: string;
  guild_id?: string;
};

const API = "https://discord.com/api/v10";

function getChannelIds() {
  const multi = process.env.DISCORD_CHANNEL_IDS;
  const legacy = process.env.DISCORD_CHANNEL_ID;
  const raw = multi || legacy || "";
  return [...new Set(raw.split(",").map((v) => v.trim()).filter(Boolean))];
}

function cutoffIso() {
  const days = Number(process.env.DISCORD_HISTORY_DAYS || "730");
  const safeDays = Number.isFinite(days) && days > 0 ? Math.min(days, 3650) : 730;
  return new Date(Date.now() - safeDays * 86400_000).toISOString();
}

function maxPerChannel() {
  const value = Number(process.env.DISCORD_HISTORY_MAX_MESSAGES || "4000");
  if (!Number.isFinite(value) || value <= 0) return 4000;
  return Math.min(Math.floor(value), 20_000);
}

async function discordFetch(path: string, token: string, counter: { value: number }) {
  for (let attempt = 0; attempt < 4; attempt++) {
    counter.value++;
    const response = await fetch(`${API}${path}`, {
      headers: {
        Authorization: `Bot ${token}`,
        "User-Agent": "WINS-Jinro-Keiba-Memo/1.0",
      },
      cache: "no-store",
      signal: AbortSignal.timeout(15000),
    });

    if (response.status === 429) {
      const payload = await response.json().catch(() => ({}));
      const retryAfter = Math.min(10, Math.max(0.5, Number(payload?.retry_after || 1)));
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (!response.ok) {
      // Never forward upstream response bodies, request headers or credentials.
      throw new Error(`Discord API ${response.status}`);
    }

    return response;
  }

  throw new Error("Discord API rate limit: retry limit exceeded");
}

async function fetchChannel(channelId: string, token: string, counter: { value: number }): Promise<DiscordChannel> {
  const response = await discordFetch(`/channels/${channelId}`, token, counter);
  return response.json();
}

async function fetchChannelHistory(
  channelId: string,
  token: string,
  channel: DiscordChannel,
  counter: { value: number },
) {
  const all: DiscordMemo[] = [];
  const cutoff = cutoffIso();
  const max = maxPerChannel();
  let before: string | undefined;
  let newestMessageId: string | undefined;
  let rawCount = 0;

  while (rawCount < max) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);

    const response = await discordFetch(`/channels/${channelId}/messages?${query.toString()}`, token, counter);
    const batch = (await response.json()) as DiscordRawMessage[];
    if (!batch.length) break;
    rawCount += batch.length;
    newestMessageId ||= batch[0]?.id;

    for (const msg of batch) {
      if (!msg.content?.trim()) continue;
      if (msg.timestamp < cutoff) continue;
      const guildId = msg.guild_id || channel.guild_id;
      all.push({
        id: msg.id,
        channelId,
        channelName: channel.name || channelId,
        guildId,
        authorName: msg.author?.global_name || msg.author?.username || "不明",
        content: msg.content,
        timestamp: msg.timestamp,
        messageUrl: guildId
          ? `https://discord.com/channels/${guildId}/${channelId}/${msg.id}`
          : undefined,
      });
    }

    const oldest = batch[batch.length - 1];
    if (!oldest) break;
    if (oldest.timestamp < cutoff) break;
    if (batch.length < 100) break;
    before = oldest.id;
  }

  return { messages: all.slice(0, max), newestMessageId };
}

function compareSnowflakes(a: string, b: string) {
  try {
    const aa = BigInt(a);
    const bb = BigInt(b);
    return aa < bb ? -1 : aa > bb ? 1 : 0;
  } catch {
    return a.localeCompare(b);
  }
}

function toMemo(msg: DiscordRawMessage, channelId: string, channel: DiscordChannel): DiscordMemo | null {
  if (!msg.content?.trim()) return null;
  const guildId = msg.guild_id || channel.guild_id;
  return {
    id: msg.id,
    channelId,
    channelName: channel.name || channelId,
    guildId,
    authorName: msg.author?.global_name || msg.author?.username || "不明",
    content: msg.content,
    timestamp: msg.timestamp,
    messageUrl: guildId
      ? `https://discord.com/channels/${guildId}/${channelId}/${msg.id}`
      : undefined,
  };
}

async function fetchNewMessages(
  channelId: string,
  token: string,
  channel: DiscordChannel,
  afterId: string,
  counter: { value: number },
) {
  const messages: DiscordMemo[] = [];
  const max = maxPerChannel();
  let before: string | undefined;
  let newestMessageId = afterId;
  let rawCount = 0;
  let reachedPrevious = false;

  while (rawCount < max) {
    // Discord returns newest -> oldest. Walk backwards until the previous
    // high-water mark so bursts larger than 100 messages cannot leave gaps.
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);
    const response = await discordFetch(`/channels/${channelId}/messages?${query.toString()}`, token, counter);
    const batch = (await response.json()) as DiscordRawMessage[];
    if (!batch.length) { reachedPrevious = true; break; }
    rawCount += batch.length;

    if (!before && batch[0] && compareSnowflakes(batch[0].id, newestMessageId) > 0) {
      newestMessageId = batch[0].id;
    }
    for (const raw of batch) {
      if (compareSnowflakes(raw.id, afterId) <= 0) {
        reachedPrevious = true;
        break;
      }
      const memo = toMemo(raw, channelId, channel);
      if (memo) messages.push(memo);
    }

    const oldest = batch[batch.length - 1];
    if (reachedPrevious || batch.length < 100 || !oldest) { reachedPrevious = true; break; }
    before = oldest.id;
  }

  // Do not advance beyond an unprocessed gap when a very large backlog hits
  // the configured batch limit. Existing saved messages/cursor remain intact.
  if (!reachedPrevious) throw new Error("新着メモが1回の取得上限を超えました");

  return { messages: messages.slice(0, max), newestMessageId };
}

export async function syncDiscordMemos(previous?: DiscordMemoStore) {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const channelIds = getChannelIds();

  if (!token) {
    return {
      store: previous,
      errors: ["DISCORD_BOT_TOKEN が設定されていません。"],
      channelCount: channelIds.length,
      fetchedCount: 0,
      externalRequestCount: 0,
      mode: previous ? "incremental" as const : "initial" as const,
    };
  }
  if (!channelIds.length) {
    return {
      store: previous,
      errors: ["DISCORD_CHANNEL_IDS が設定されていません。"],
      channelCount: 0,
      fetchedCount: 0,
      externalRequestCount: 0,
      mode: previous ? "incremental" as const : "initial" as const,
    };
  }

  const errors: string[] = [];
  const counter = { value: 0 };
  const channels: Record<string, DiscordChannelState> = { ...(previous?.channels || {}) };
  const merged = new Map((previous?.memos || []).map((memo) => [memo.id, memo]));
  let fetchedCount = 0;
  let usedInitial = false;

  // Sequential by channel so Discord rate limits are easier to respect.
  for (const channelId of channelIds) {
    try {
      const oldState = previous?.channels[channelId];
      const channel: DiscordChannel = oldState
        ? { id: channelId, name: oldState.channelName, guild_id: oldState.guildId }
        : await fetchChannel(channelId, token, counter);
      const result = oldState?.newestMessageId
        ? await fetchNewMessages(channelId, token, channel, oldState.newestMessageId, counter)
        : await fetchChannelHistory(channelId, token, channel, counter);
      usedInitial ||= !oldState?.newestMessageId;
      fetchedCount += result.messages.length;
      for (const memo of result.messages) merged.set(memo.id, memo);
      channels[channelId] = {
        channelId,
        channelName: channel.name || channelId,
        guildId: channel.guild_id,
        newestMessageId: result.newestMessageId || oldState?.newestMessageId,
        updatedAt: new Date().toISOString(),
      };
    } catch {
      errors.push(`Discordチャンネル${channelIds.indexOf(channelId) + 1}: 更新に失敗しました（接続・権限・取得上限を確認）。保存済みメモを保持します。`);
    }
  }

  const cutoff = cutoffIso();
  const memos = [...merged.values()]
    .filter((memo) => memo.timestamp >= cutoff)
    .sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  const store: DiscordMemoStore = {
    version: 1,
    updatedAt: new Date().toISOString(),
    channels,
    memos,
  };

  return {
    store,
    errors,
    channelCount: channelIds.length,
    fetchedCount,
    externalRequestCount: counter.value,
    mode: usedInitial ? "initial" as const : "incremental" as const,
  };
}

/** Legacy helper kept for local diagnostics. Public page rendering never calls it. */
export async function getDiscordMemos() {
  const result = await syncDiscordMemos();
  return {
    memos: result.store?.memos || [],
    errors: result.errors,
    channelCount: result.channelCount,
  };
}
