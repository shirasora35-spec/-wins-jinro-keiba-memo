export type DiscordMemo = {
  id: string;
  channelId: string;
  channelName: string;
  guildId?: string;
  authorName: string;
  content: string;
  timestamp: string;
  messageUrl?: string;
};

export type RaceHorse = {
  name: string;
  number?: number;
};

export type Race = {
  date: string;
  venue: string;
  raceNumber: number;
  raceName: string;
  raceId: string;
  sourceUrl?: string;
  horses: RaceHorse[];
};

export type HorseMemo = {
  messageId: string;
  channelId: string;
  channelName: string;
  authorName: string;
  timestamp: string;
  excerpt: string;
  originalContent: string;
  messageUrl?: string;
};

export type MatchedHorse = {
  date: string;
  venue: string;
  raceNumber: number;
  raceName: string;
  raceId: string;
  raceUrl?: string;
  horseName: string;
  horseNumber?: number;
  memos: HorseMemo[];
};

export type Diagnostics = {
  raceSource: string;
  raceDates: string[];
  raceCount: number;
  runnerCount: number;
  discordChannelCount: number;
  discordMessageCount: number;
  errors: string[];
  generatedAt: string;
  discordSyncMode?: "initial" | "incremental" | "cached";
  discordFetchedCount?: number;
  externalRequestCount?: number;
};

export type DiscordChannelState = {
  channelId: string;
  channelName: string;
  guildId?: string;
  newestMessageId?: string;
  updatedAt: string;
};

export type DiscordMemoStore = {
  version: 1;
  updatedAt: string;
  channels: Record<string, DiscordChannelState>;
  memos: DiscordMemo[];
};

export type RaceStore = {
  version: 1;
  weekStart: string;
  updatedAt: string;
  races: Race[];
  errors: string[];
  source: string;
  externalRequestCount: number;
};

export type PublishedSnapshot = {
  version: 1;
  weekStart: string;
  dates: string[];
  raceDates: string[];
  matches: MatchedHorse[];
  diagnostics: Diagnostics;
};
