import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { vendorOverview } from "@/lib/vendorflow/service";

export default function VendorHome({ params }: PageProps<"/w/[slug]/vendor">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const WO_LABEL: Record<string, string> = { issued: "Ready to start", in_progress: "In progress", completed: "Work done", cancelled: "Cancelled" };
const car = (r: { registration_no: string; make: string | null; model: string | null }) => [r.registration_no, r.make, r.model].filter(Boolean).join(" · ");

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const { requests, orders } = await vendorOverview(getDriver(), m);
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold">My work</h1>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Waiting for your quotation <span className="font-normal text-zinc-500">{requests.length}</span></h2>
        {requests.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600">Nothing waiting.</p> : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm">
            {requests.map((r) => (
              <li key={r.job_card_id} className="flex flex-wrap items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{r.job_no} · {car(r)}</p>
                  <p className="truncate text-zinc-600">{r.cause_text}</p>
                  {r.needed_by && <p className="text-xs text-zinc-500">Needed by {r.needed_by}</p>}
                </div>
                {r.job_status === "quotation_received"
                  ? <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs text-sky-800">Quotation sent, waiting for decision</span>
                  : <a href={`/w/${slug}/vendor/jobs/${r.job_card_id}`} className="rounded-md bg-sky-800 px-3 py-2 text-white">{r.last_quotation_status === "rejected" ? "Send a new quotation" : "Send quotation"}</a>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Work orders <span className="font-normal text-zinc-500">{orders.length}</span></h2>
        {orders.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600">No work orders yet.</p> : (
          <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm">
            {orders.map((o) => (
              <li key={o.work_order_id} className="flex flex-wrap items-center gap-2 p-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium"><a className="text-sky-800 hover:underline" href={`/w/${slug}/vendor/orders/${o.work_order_id}`}>{o.wo_no}</a> · {car(o)}</p>
                  <p className="truncate text-zinc-600">{o.job_no} · {o.cause_text}</p>
                </div>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700">{o.job_status === "invoiced" ? "Invoice sent" : o.job_status === "invoice_verified" || o.job_status === "closed" ? "Checked" : WO_LABEL[o.wo_status] ?? o.wo_status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
