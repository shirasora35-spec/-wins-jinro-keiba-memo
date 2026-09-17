import { readJson, snapshotPath } from "./storage";
import type { PublishedSnapshot } from "./types";
import { unstable_cache } from "next/cache";

/** Public rendering reads only this prebuilt weekly snapshot. */
export async function getPublishedSnapshot(weekStart: string) {
  return unstable_cache(
    async () => (await readJson<PublishedSnapshot>(snapshotPath(weekStart)))?.value || null,
    ["published-snapshot", weekStart],
    { revalidate: 60 },
  )();
}
