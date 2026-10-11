import { getTargetRaceDates } from "../../../lib/date";
import { getPublishedSnapshot } from "../../../lib/published";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const weekStart = new URL(request.url).searchParams.get("weekStart") || "";
  const now = new Date();
  const allowedWeeks = new Set([
    getTargetRaceDates(now, "current")[0],
    getTargetRaceDates(now, "last")[0],
  ]);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart) || !allowedWeeks.has(weekStart)) {
    return Response.json({ error: "Requested week is not available." }, { status: 400 });
  }

  const snapshot = await getPublishedSnapshot(weekStart);
  if (!snapshot) return Response.json({ error: "Saved week data is not available yet." }, { status: 404 });

  return Response.json(snapshot, {
    headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
  });
}
