// The ledger and the tax summary as CSV for the accountant. Operator only: the operator check runs here and again inside the query.
import { NextResponse, type NextRequest } from "next/server";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { journalCsv, taxSummaryCsv } from "@/lib/billing/accounting";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: NextRequest, ctx: RouteContext<"/admin/accounting/export/[kind]">) {
  const op = await requireOperator();
  const { kind } = await ctx.params;
  if (kind !== "journal" && kind !== "tax-summary") return new NextResponse("Not found", { status: 404 });
  const q = request.nextUrl.searchParams;
  const from = q.get("from") ?? undefined, to = q.get("to") ?? undefined;
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) return new NextResponse("Dates look like 2026-10-31", { status: 400 });
  const body = kind === "journal" ? await journalCsv(getDriver(), op.id, { from, to }) : await taxSummaryCsv(getDriver(), op.id, { from, to });
  return new NextResponse(body, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="fleet-otg-${kind}.csv"`, "cache-control": "no-store" } });
}
