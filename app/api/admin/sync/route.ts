import { isAuthorizedSyncRequest } from "../../../../lib/admin-auth";
import { reportSyncFailure } from "../../../../lib/sync-error";
import type { SyncScope } from "../../../../lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const allowedScopes = new Set<SyncScope>(["all", "discord", "races", "today"]);

export async function POST(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const requested = new URL(request.url).searchParams.get("scope") || "all";
  if (!allowedScopes.has(requested as SyncScope)) {
    return Response.json({ ok: false, error: "Invalid scope" }, { status: 400 });
  }

  try {
    const { syncPublishedData } = await import("../../../../lib/sync");
    return Response.json(await syncPublishedData(requested as SyncScope));
  } catch (error) {
    const diagnostic = reportSyncFailure(error);
    return Response.json({
      ok: false,
      error: "Sync failed. Check storage configuration and retry.",
      diagnostic,
    }, { status: 500 });
  }
}
