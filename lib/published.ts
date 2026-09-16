import { readJson, snapshotPath } from "./storage";
import type { PublishedSnapshot } from "./types";

/** Public rendering reads only this prebuilt weekly snapshot. */
export async function getPublishedSnapshot(weekStart: string) {
  return (await readJson<PublishedSnapshot>(snapshotPath(weekStart)))?.value || null;
}
