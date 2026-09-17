import { get, head, put, BlobNotFoundError } from "@vercel/blob";
import { promises as fs } from "node:fs";
import path from "node:path";
import { classifySyncError, SyncStorageError } from "./sync-error";

export type StoredJson<T> = {
  value: T;
  etag?: string;
};

function useLocalStorage() {
  return process.env.VERCEL !== "1" && !process.env.BLOB_STORE_ID && !process.env.BLOB_READ_WRITE_TOKEN;
}

function hasBlobStorage() {
  return Boolean(process.env.BLOB_STORE_ID || process.env.BLOB_READ_WRITE_TOKEN);
}

function localPath(pathname: string) {
  return path.join(process.cwd(), ".data", pathname);
}

export async function readJson<T>(pathname: string, fresh = false): Promise<StoredJson<T> | null> {
  if (useLocalStorage()) {
    try {
      const value = JSON.parse(await fs.readFile(localPath(pathname), "utf8")) as T;
      return { value };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  // Keep the public page available while a newly deployed project is waiting
  // for its Blob store to be connected. Sync writes still fail explicitly.
  if (!hasBlobStorage()) return null;

  try {
    // Read the storage API's canonical generation before the body. The HTTP
    // download ETag can differ from the write API ETag. Never drop ifMatch or
    // retry a conflict as an unconditional overwrite.
    const metadata = fresh ? await head(pathname) : undefined;
    const result = await get(pathname, { access: "private", useCache: !fresh });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const value = await new Response(result.stream).json() as T;
    return { value, etag: metadata?.etag || result.blob.etag };
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    throw new SyncStorageError("storage-read", classifySyncError(error));
  }
}

export async function writeJson<T>(pathname: string, value: T, etag?: string) {
  const body = JSON.stringify(value);
  if (useLocalStorage()) {
    const filename = localPath(pathname);
    await fs.mkdir(path.dirname(filename), { recursive: true });
    await fs.writeFile(filename, body, "utf8");
    return;
  }


  if (!hasBlobStorage()) {
    throw new Error("Persistent Blob storage is not configured");
  }

  try { await put(pathname, body, {
    access: "private",
    contentType: "application/json; charset=utf-8",
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 60,
    ...(etag ? { ifMatch: etag } : {}),
  }); } catch (error) {
    throw new SyncStorageError("storage-write", classifySyncError(error));
  }
}

export function discordStorePath() {
  return "keiba-cache/discord-memos.json";
}

export function raceStorePath(weekStart: string) {
  return `keiba-cache/races/${weekStart}.json`;
}

export function snapshotPath(weekStart: string) {
  return `keiba-cache/snapshots/${weekStart}.json`;
}
