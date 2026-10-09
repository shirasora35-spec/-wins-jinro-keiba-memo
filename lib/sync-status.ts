import { readJson, syncStatusPath, writeJson } from "./storage";
import type { SyncScope } from "./sync";
import type { SyncStatus } from "./types";

async function updateStatus(patch: Partial<SyncStatus>) {
  try {
    const previous = await readJson<SyncStatus>(syncStatusPath(), true);
    await writeJson(syncStatusPath(), { ...previous?.value, ...patch } as SyncStatus, previous?.etag);
  } catch {
    // Monitoring storage must not stop the primary data refresh.
    console.error("sync-status-persist-failed");
  }
}

export async function recordSyncAttempt(scope: SyncScope, at = new Date()) {
  await updateStatus({
    lastAttemptAt: at.toISOString(),
    lastScope: scope,
    outcome: "running",
  });
}

export async function recordSyncSuccess(
  result: { errors?: string[]; externalRequestCount?: number },
  at = new Date(),
) {
  await updateStatus({
    lastSuccessAt: at.toISOString(),
    outcome: result.errors?.length ? "warning" : "success",
    diagnostic: result.errors?.slice(0, 3).join(" / ") || undefined,
    externalRequestCount: result.externalRequestCount || 0,
  });
}

export async function recordSyncFailure(diagnostic: { stage?: string; code?: string }, at = new Date()) {
  await updateStatus({
    outcome: "failed",
    diagnostic: [diagnostic.stage, diagnostic.code].filter(Boolean).join(": ") || "SYNC_FAILED",
  });
}

export async function getSyncStatus() {
  try {
    const stored = await readJson<SyncStatus>(syncStatusPath());
    return stored?.value || null;
  } catch {
    return null;
  }
}
