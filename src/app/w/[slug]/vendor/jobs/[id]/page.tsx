import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { vendorGetRequest, vendorOverview } from "@/lib/vendorflow/service";
import { Panel, Pill, Plate } from "@/components/ui";
import { dayMonth } from "@/lib/labels";
import { VendorStepper } from "../../stepper";
import { QuotationForm } from "./form";

export default function QuotePage({ params }: PageProps<"/w/[slug]/vendor/jobs/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const OTHER: Record<string, { text: string; tone: "ok" | "info" | "warn" | "neutral" }> = {
  issued: { text: "Ready to start", tone: "info" }, in_progress: { text: "In repair", tone: "info" }, completed: { text: "Work done", tone: "warn" },
};

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [r, overview] = await Promise.all([vendorGetRequest(driver, m, id), vendorOverview(driver, m)]);
  if (!r) notFound();
  if (r.job_status !== "vendor_assigned") redirect(`/w/${slug}/vendor`);
  const to = (p: string) => `/w/${slug}/${p}`;
  return (
    <main className="mx-auto w-full max-w-6xl space-y-5 p-6 text-zinc-900">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-zinc-500"><a className="underline" href={to("vendor")}>My work</a> / {r.job_no}</p>
          <h1 className="text-[22px] font-semibold leading-tight">Quotation for <span className="font-mono">{r.job_no}</span></h1>
          <p className="mt-0.5 text-sm text-zinc-500">From {m.tenantName ?? "the fleet office"}{r.assigned_at && <> · assigned {dayMonth(r.assigned_at)}</>}</p>
        </div>
        <Pill tone="info">Waiting for your quotation</Pill>
      </div>
      <VendorStepper jobStatus="vendor_assigned" />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Panel title="What needs fixing" action={<Plate>{r.registration_no}</Plate>}>
            <dl className="grid gap-4 text-sm sm:grid-cols-4">
              <div><dt className="text-xs text-zinc-500">Vehicle</dt><dd className="mt-0.5">{[r.make, r.model, r.year].filter(Boolean).join(" ")}</dd></div>
              <div><dt className="text-xs text-zinc-500">Odometer</dt><dd className="mt-0.5 font-mono">{r.odometer_km ? `${Number(r.odometer_km).toLocaleString("en-US")} km` : "—"}</dd></div>
              <div><dt className="text-xs text-zinc-500">Priority</dt><dd className="mt-0.5"><Pill tone={r.priority === "urgent" || r.priority === "high" ? "warn" : "neutral"}><span className="capitalize">{r.priority}</span></Pill></dd></div>
              <div><dt className="text-xs text-zinc-500">Bring in by</dt><dd className="mt-0.5">{r.needed_by ? dayMonth(r.needed_by) : "—"}</dd></div>
            </dl>
            <p className="mt-4 text-xs font-medium text-zinc-500">Reported problem</p>
            <p className="mt-1 whitespace-pre-wrap text-sm">{r.cause_text}</p>
            {r.description && <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">{r.description}</p>}
            <p className="mt-3 text-xs text-zinc-500">You will not see the requester&apos;s name or the fleet&apos;s budget.</p>
          </Panel>
          <QuotationForm slug={slug} jobId={id} />
        </div>

        <aside className="space-y-5">
          <Panel title="After the repair">
            <p className="text-sm text-zinc-600">These unlock once the fleet manager approves your quotation. Shown so you know what comes next.</p>
            <div className="mt-3 space-y-2" aria-hidden="true">
              <div className="h-10 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm leading-10 text-zinc-600">Your invoice number</div>
              <div className="h-10 rounded-md border border-zinc-200 bg-zinc-50 px-3 text-sm leading-10 text-zinc-600">Must match the approved quote unless explained</div>
              <div className="rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center text-sm text-zinc-600">Locked</div>
            </div>
          </Panel>
          <Panel title="Rules for this order">
            <p className="rounded-md bg-amber-100 p-3 text-sm text-amber-800">Extra work found after you open the vehicle needs a new approval before you do it. The invoice is checked against the approved quotation.</p>
          </Panel>
          <Panel title="Your other orders" flush>
            {overview.orders.length === 0 ? <p className="p-5 text-sm text-zinc-500">None yet.</p> : (
              <ul className="divide-y divide-zinc-100 text-sm">{overview.orders.slice(0, 5).map((o) => {
                const st = o.job_status === "invoiced" ? { text: "Invoice sent", tone: "info" as const } : o.job_status === "invoice_verified" || o.job_status === "closed" ? { text: "Invoice checked", tone: "ok" as const } : OTHER[o.wo_status] ?? { text: o.wo_status, tone: "neutral" as const };
                return <li key={o.work_order_id} className="flex items-center justify-between gap-3 px-5 py-3"><span><Plate>{o.registration_no}</Plate><span className="mt-1 block font-mono text-xs text-zinc-500">{o.wo_no}</span></span><Pill tone={st.tone}>{st.text}</Pill></li>;
              })}</ul>
            )}
          </Panel>
        </aside>
      </div>
    </main>
  );
}
