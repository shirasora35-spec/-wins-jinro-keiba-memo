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
  return await new Response(result.stream).json() as PublishedSnapshot;
}
