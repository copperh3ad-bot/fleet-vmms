import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { ForbiddenError } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { Card } from "@/components/form";
import { getDashboard, type Dashboard } from "@/lib/dashboard/service";

export default function WorkspaceHome({ params }: PageProps<"/w/[slug]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Workspace params={params} /></Suspense>;
}

const ROLE: Record<string, string> = { tenant_admin: "Administrator", fleet_manager: "Fleet manager", finance: "Finance", requester: "Requester", auditor: "Auditor", vendor: "Workshop" };
const STATUS: Record<string, string> = {
  submitted: "Waiting for approval", approved: "Approved", vendor_assigned: "Waiting for quotation", quotation_received: "Quotation to decide", quotation_approved: "Work order issued",
  in_progress: "Work in progress", completed: "Work done", invoiced: "Invoice to check", invoice_verified: "Ready to close", returned_for_edit: "Sent back for edit",
};
const PM: Record<string, { text: string; cls: string }> = {
  overdue: { text: "Service overdue", cls: "bg-red-100 text-red-800" }, due_soon: { text: "Service due soon", cls: "bg-amber-100 text-amber-800" },
  no_history: { text: "No service history", cls: "bg-zinc-100 text-zinc-700" }, scheduled: { text: "Service booked", cls: "bg-sky-100 text-sky-800" }, ok: { text: "Service OK", cls: "bg-green-100 text-green-800" },
};
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

async function Workspace({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  if (m.role === "vendor") redirect(`/w/${slug}/vendor`);   // workshops only have their own work list
  let d: Dashboard | null = null;
  try { d = await getDashboard(getDriver(), m); } catch (e) { if (!(e instanceof ForbiddenError)) throw e; }
  const to = (href: string) => `/w/${slug}/${href}`;
  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 p-4 text-zinc-900">
      <div className="flex flex-wrap items-baseline gap-2"><h1 className="text-xl font-semibold">{slug}</h1><span className="text-sm text-zinc-600">{ROLE[m.role] ?? m.role}</span></div>
      {!d && <p className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">Nothing is set up for your role yet. Ask your administrator.</p>}

      {d && (
        <section aria-labelledby="todo" className="space-y-2">
          <h2 id="todo" className="text-sm font-semibold">Needs you</h2>
          {d.actions.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600">Nothing is waiting for you.</p> : (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {d.actions.map((a) => (
                <li key={a.key} className="rounded-lg border border-zinc-200 bg-white p-3">
                  <a href={to(a.href)} className="flex items-baseline gap-3"><span className="text-3xl font-semibold tabular-nums">{a.count}</span><span className="text-sm text-sky-800 hover:underline">{a.label}</span></a>
                  {a.samples.length > 0 && <ul className="mt-2 space-y-0.5 text-xs text-zinc-600">{a.samples.map((s) => <li key={s.href}><a className="hover:underline" href={to(s.href)}>{s.text}</a></li>)}</ul>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {d && d.myVehicles.length > 0 && (
        <Card title={d.myVehicles.length === 1 ? "Your vehicle" : "Your vehicles"}>
          <ul className="divide-y divide-zinc-100 text-sm">
            {d.myVehicles.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 py-2">
                <a className="font-medium text-sky-800 hover:underline" href={to(`vehicles/${v.id}`)}>{v.registration_no}</a><span className="text-zinc-600">{v.label}</span>
                <span className="ml-auto flex flex-wrap gap-2">
                  {v.pm_worst && <span className={`rounded-full px-2 py-0.5 text-xs ${PM[v.pm_worst].cls}`}>{PM[v.pm_worst].text}</span>}
                  {v.docs_expired > 0 && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">{v.docs_expired} document{v.docs_expired > 1 ? "s" : ""} expired</span>}
                  {v.docs_due > 0 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{v.docs_due} expiring soon</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {d?.health && (
        <section aria-labelledby="health" className="space-y-2">
          <h2 id="health" className="text-sm font-semibold">Fleet at a glance</h2>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              ["Vehicles in service", String((d.health.vehicles.active ?? 0) + (d.health.vehicles.in_workshop ?? 0)), d.health.vehicles.in_workshop ? `${d.health.vehicles.in_workshop} in the workshop` : "", "vehicles"],
              ["Service overdue", String(d.health.service.overdue), d.health.service.due_soon ? `${d.health.service.due_soon} due soon` : "", "vehicles"],
              ["Flags", String(d.health.flags.high + d.health.flags.medium), d.health.flags.high ? `${d.health.flags.high} serious` : "", "reports"],
              ["Spent this month", money(d.health.monthSpend), d.health.fleetBudget ? `${d.health.fleetBudget.pct}% of the fleet budget` : "no fleet budget set", "reports"],
            ].map(([l, v, note, href]) => (
              <a key={l} href={to(href)} className="rounded-lg border border-zinc-200 bg-white p-3"><p className="text-xs text-zinc-500">{l}</p><p className="text-2xl font-semibold tabular-nums">{v}</p><p className="text-xs text-zinc-500">{note || " "}</p></a>
            ))}
          </div>
          {d.health.pipeline.length > 0 && (
            <Card title="Job cards in progress">
              <ul className="flex flex-wrap gap-2 text-sm">{d.health.pipeline.map((p) => <li key={p.status}><a className="rounded-full border border-zinc-300 bg-white px-3 py-1 hover:bg-zinc-50" href={to(`job-cards?status=${p.status}`)}>{STATUS[p.status] ?? p.status} <span className="font-medium tabular-nums">{p.count}</span></a></li>)}</ul>
            </Card>
          )}
        </section>
      )}
    </main>
  );
}
