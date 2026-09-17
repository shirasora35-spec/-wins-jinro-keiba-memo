import { BlobAccessError, BlobPreconditionFailedError, BlobNotFoundError, BlobStoreNotFoundError, BlobStoreSuspendedError, BlobServiceRateLimited, BlobServiceNotAvailable } from "@vercel/blob";

export class SyncStorageError extends Error {
  constructor(public readonly stage: "storage-read" | "storage-write", public readonly code: string) {
    super("Persistent storage operation failed");
  }
}

export function classifySyncError(error: unknown): string {
  if (error instanceof Error && /Failed to fetch blob: (401|403)\b/.test(error.message)) return "STORAGE_ACCESS";
  if (error instanceof Error && /Failed to fetch blob: 5\d\d\b/.test(error.message)) return "STORAGE_UNAVAILABLE";
  if (error instanceof BlobPreconditionFailedError) return "STORAGE_CONFLICT";
  if (error instanceof BlobAccessError) return "STORAGE_ACCESS";
  if (error instanceof BlobNotFoundError) return "STORAGE_NOT_FOUND";
  if (error instanceof BlobStoreNotFoundError) return "STORAGE_STORE_NOT_FOUND";
  if (error instanceof BlobStoreSuspendedError) return "STORAGE_SUSPENDED";
  if (error instanceof BlobServiceRateLimited) return "STORAGE_RATE_LIMIT";
  if (error instanceof BlobServiceNotAvailable) return "STORAGE_UNAVAILABLE";
  if (error instanceof SyntaxError) return "INVALID_STORED_JSON";
  if (error instanceof TypeError) return "TYPE_OR_NETWORK_ERROR";
  return "UNCLASSIFIED";
}

export function reportSyncFailure(error: unknown) {
  const diagnostic = {
    event: "sync-failed",
    stage: error instanceof SyncStorageError ? error.stage : "sync",
    code: error instanceof SyncStorageError ? error.code : classifySyncError(error),
  };
  // Only fixed labels, never error.message/stack, env values or response bodies.
  console.error(JSON.stringify(diagnostic));
  return diagnostic;
}
