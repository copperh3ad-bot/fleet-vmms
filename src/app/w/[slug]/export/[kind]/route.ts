// CSV download. Signed-in members only (the proxy and requireMembership both refuse everyone else), and exportCsv
// checks the permission for this particular export. Read-only apart from one audit log row.
import type { NextRequest } from "next/server";
import { requireMembership } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { UserError } from "@/lib/master/service";
import { exportCsv } from "@/lib/exports/service";

export async function GET(req: NextRequest, ctx: RouteContext<"/w/[slug]/export/[kind]">) {
  const { slug, kind } = await ctx.params;
  const m = await requireMembership(slug, { allowLocked: true });   // your data stays yours when the workspace is locked
  const sp = req.nextUrl.searchParams;
  try {
    const r = await exportCsv(getDriver(), m, kind, { q: sp.get("q") ?? undefined, status: sp.get("status") ?? undefined, type: sp.get("type") ?? undefined, months: sp.get("months") ?? undefined });
    return new Response(r.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${r.fileName}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new Response("You do not have permission to export this.", { status: 403 });
    if (e instanceof UserError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
