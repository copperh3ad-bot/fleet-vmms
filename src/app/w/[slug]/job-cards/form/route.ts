// Download of the blank offline job card form (ADR-022). Signed-in members who may raise job cards only. It lists just the
// vehicles and reasons this member may use, carries nothing about other companies, and is not cached.
import type { NextRequest } from "next/server";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { buildJobCardForm } from "@/lib/jobcards/offline-form";
import { loadFormContext } from "@/lib/jobcards/offline-service";

export async function GET(_req: NextRequest, ctx: RouteContext<"/w/[slug]/job-cards/form">) {
  const { slug } = await ctx.params;
  const m = await requireMembership(slug);
  const driver = getDriver();
  if (!(await permissionsOf(driver, m)).has("jobcard.create")) return new Response("You do not have permission to raise job cards.", { status: 403 });
  const bytes = await buildJobCardForm(await loadFormContext(driver, m));
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="fleet-otg-job-card-form.xlsx"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
