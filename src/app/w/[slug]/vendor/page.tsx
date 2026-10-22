import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { vendorOverview } from "@/lib/vendorflow/service";
import { PageHeader, Panel, Pill, Plate, btn, btnPrimary } from "@/components/ui";
import { dayMonth, plural } from "@/lib/labels";

export default function VendorHome({ params }: PageProps<"/w/[slug]/vendor">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const { requests, orders } = await vendorOverview(getDriver(), m);
  const to = (p: string) => `/w/${slug}/${p}`;
  const car = (r: { make: string | null; model: string | null; year: number | null }) => [r.make, r.model, r.year].filter(Boolean).join(" ");
  const state = (o: (typeof orders)[number]) =>
    o.job_status === "invoiced" ? <Pill tone="info">Invoice sent</Pill> : ["invoice_verified", "closed"].includes(o.job_status) ? <Pill tone="ok">Invoice checked</Pill>
    : o.wo_status === "issued" ? <Pill tone="info">Ready to start</Pill> : o.wo_status === "in_progress" ? <Pill tone="info">In repair</Pill> : o.wo_status === "completed" ? <Pill tone="warn">Send your invoice</Pill> : <Pill>{o.wo_status}</Pill>;
  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 p-6 text-zinc-900">
      <PageHeader title="My work" sub={`${m.tenantName ?? ""} · ${plural(requests.length, "quotation")} to send · ${plural(orders.length, "work order")}`} />

      <Panel title="Waiting for your quotation" sub={String(requests.length)} flush>
        {requests.length === 0 ? <p className="p-5 text-sm text-zinc-500">Nothing is waiting.</p> : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {requests.map((r) => (
              <li key={r.job_card_id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <Plate>{r.registration_no}</Plate>
                <div className="min-w-0 flex-1">
                  <p className="font-medium"><span className="font-mono">{r.job_no}</span> <span className="font-normal text-zinc-500">{car(r)}</span></p>
                  <p className="truncate text-zinc-600">{r.cause_text}</p>
                  <p className="mt-0.5 text-xs text-zinc-500 capitalize">{r.priority}{r.needed_by ? ` · bring in by ${dayMonth(r.needed_by)}` : ""}</p>
                </div>
                {r.job_status === "quotation_received"
                  ? <Pill tone="info">Quotation sent, waiting for a decision</Pill>
                  : <a href={to(`vendor/jobs/${r.job_card_id}`)} className={btnPrimary}>{r.last_quotation_status === "rejected" ? "Send a new quotation" : "Send quotation"}</a>}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Work orders" sub={String(orders.length)} flush>
        {orders.length === 0 ? <p className="p-5 text-sm text-zinc-500">No work orders yet.</p> : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {orders.map((o) => (
              <li key={o.work_order_id} className="flex flex-wrap items-center gap-4 px-5 py-4">
                <Plate>{o.registration_no}</Plate>
                <div className="min-w-0 flex-1"><p className="font-medium"><span className="font-mono">{o.wo_no}</span> <span className="font-normal text-zinc-500">{car(o)}</span></p><p className="truncate text-zinc-600">{o.job_no} · {o.cause_text}</p></div>
                {state(o)}
                <a href={to(`vendor/orders/${o.work_order_id}`)} className={btn}>Open</a>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}
