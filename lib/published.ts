import { get } from "@vercel/blob";
import type { PublishedSnapshot } from "./types";

/** Public rendering reads only this prebuilt weekly snapshot. */
export async function getPublishedSnapshot(weekStart: string) {
  if (!process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN) return null;
  const result = await get(`keiba-cache/snapshots/${weekStart}.json`, {
    access: "private",
    useCache: true,
  });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  const snapshot = await new Response(result.stream).json() as PublishedSnapshot;
  return {
    ...snapshot,
    matches: snapshot.matches.map((horse) => ({
      ...horse,
      // The UI displays excerpt. Do not serialize the same full multi-horse
      // Discord post repeatedly for every matching horse and both weeks.
      memos: horse.memos.map((memo) => ({ ...memo, originalContent: "" })),
    })),
  };
}
