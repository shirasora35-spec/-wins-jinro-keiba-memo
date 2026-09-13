import { DiscordMemo } from "./types";

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

async function discordFetch(path: string, token: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const response = await fetch(`${API}${path}`, {
      headers: {
        Authorization: `Bot ${token}`,
        "User-Agent": "WINS-Jinro-Keiba-Memo/1.0",
      },
      cache: "no-store",
    });

    if (response.status === 429) {
      const payload = await response.json().catch(() => ({}));
      const retryAfter = Math.max(0.5, Number(payload?.retry_after || 1));
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Discord API ${response.status}: ${body.slice(0, 180)}`);
    }

    return response;
  }

  throw new Error("Discord API rate limit: retry limit exceeded");
}

async function fetchChannel(channelId: string, token: string): Promise<DiscordChannel> {
  const response = await discordFetch(`/channels/${channelId}`, token);
  return response.json();
}

async function fetchChannelMessages(channelId: string, token: string, channel: DiscordChannel) {
  const all: DiscordMemo[] = [];
  const cutoff = cutoffIso();
  const max = maxPerChannel();
  let before: string | undefined;

  while (all.length < max) {
    const query = new URLSearchParams({ limit: "100" });
    if (before) query.set("before", before);

    const response = await discordFetch(`/channels/${channelId}/messages?${query.toString()}`, token);
    const batch = (await response.json()) as DiscordRawMessage[];
    if (!batch.length) break;

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

  return all.slice(0, max);
}

export async function getDiscordMemos() {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  const channelIds = getChannelIds();

  if (!token) {
    return {
      memos: [] as DiscordMemo[],
      errors: ["DISCORD_BOT_TOKEN が設定されていません。"],
      channelCount: channelIds.length,
    };
  }
  if (!channelIds.length) {
    return {
      memos: [] as DiscordMemo[],
      errors: ["DISCORD_CHANNEL_IDS が設定されていません。"],
      channelCount: 0,
    };
  }

  const errors: string[] = [];
  const merged: DiscordMemo[] = [];

  // Sequential by channel so Discord rate limits are easier to respect.
  for (const channelId of channelIds) {
    try {
      const channel = await fetchChannel(channelId, token);
      const messages = await fetchChannelMessages(channelId, token, channel);
      merged.push(...messages);
    } catch (error) {
      errors.push(`${channelId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const unique = new Map<string, DiscordMemo>();
  for (const memo of merged) unique.set(memo.id, memo);
  const memos = [...unique.values()].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );

  return { memos, errors, channelCount: channelIds.length };
}
