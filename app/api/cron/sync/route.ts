import { isAuthorizedSyncRequest } from "../../../../lib/admin-auth";
import { syncPublishedData, type SyncScope } from "../../../../lib/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const scopesBySchedule: Record<string, SyncScope> = {
  "0 20 * * 0": "discord",
  "0 7 * * 4": "all",
  "0 7 * * 5": "all",
  "30 21 * * 5": "today",
  "30 21 * * 6": "today",
  "30 21 * * 0": "today",
};

export async function GET(request: Request) {
  if (!isAuthorizedSyncRequest(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const schedule = request.headers.get("x-vercel-cron-schedule") || "";
  const scope = scopesBySchedule[schedule] || "all";
  try {
    return Response.json(await syncPublishedData(scope));
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : "Sync failed",
    }, { status: 500 });
  }
}
