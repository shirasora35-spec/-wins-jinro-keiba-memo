import { isAuthorizedSyncRequest } from "../../../../lib/admin-auth";
import { reportSyncFailure } from "../../../../lib/sync-error";
import type { SyncScope } from "../../../../lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const allowedScopes = new Set<SyncScope>(["all", "discord", "races", "today", "results"]);

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const requested = new URL(request.url).searchParams.get("scope") || "all";
  if (!allowedScopes.has(requested as SyncScope)) {
    return Response.json({ ok: false, error: "Invalid scope" }, { status: 400 });
  }

  const scope = requested as SyncScope;
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

