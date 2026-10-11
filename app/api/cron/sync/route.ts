import { isAuthorizedSyncRequest } from "../../../../lib/admin-auth";
import { reportSyncFailure } from "../../../../lib/sync-error";
import type { SyncScope } from "../../../../lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const scopesBySchedule: Record<string, SyncScope> = {
  "0 20 * * 0": "discord",
  "0 13 * * 4": "all",
  "0 13 * * 5": "all",
  "30 21 * * 5": "today",
  "30 21 * * 6": "today",
  "30 21 * * 0": "today",
  "30 21 * * 1": "results",
};

export async function GET(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const schedule = request.headers.get("x-vercel-cron-schedule") || "";
  const scope = scopesBySchedule[schedule] || "all";
  const { recordSyncAttempt, recordSyncFailure, recordSyncSuccess } = await import("../../../../lib/sync-status");
  await recordSyncAttempt(scope);
  try {
    const { syncPublishedData } = await import("../../../../lib/sync");
    const result = await syncPublishedData(scope);
    await recordSyncSuccess(result);
    return Response.json(result);
  } catch (error) {
    const diagnostic = reportSyncFailure(error);
    await recordSyncFailure(diagnostic);
    return Response.json({
      ok: false,
      error: "Sync failed. Check storage configuration and retry.",
      diagnostic,
    }, { status: 500 });
  }
}

