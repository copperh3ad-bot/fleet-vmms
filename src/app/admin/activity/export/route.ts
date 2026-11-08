// The activity log as CSV for an audit. Operator only: the operator check runs here and again inside the query. The download is itself logged.
import { NextResponse, type NextRequest } from "next/server";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { activityCsv, type ActivityFilter } from "@/lib/activity/read";
import { logActivity } from "@/lib/activity/log";
import { loggedRoute } from "@/lib/activity/route";

async function getImpl(request: NextRequest) {
  const op = await requireOperator();
  const q = request.nextUrl.searchParams;
  const f: ActivityFilter = {
    kind: q.get("kind") ?? undefined, outcome: q.get("outcome") ?? undefined, q: q.get("q") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined,
    tenant: q.get("tenant") ?? undefined, actor: q.get("actor") ?? undefined, request: q.get("request") ?? undefined,
  };
  const out = await activityCsv(getDriver(), op.id, f);
  await logActivity({ kind: "security", name: "activity log downloaded", outcome: "info", actorId: op.id, role: "operator", details: { rows: out.rows, filters: f } });
  return new NextResponse(out.csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="fleet-otg-activity-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "private, no-store" } });
}

export const GET = loggedRoute("billing", "activity export", getImpl);
