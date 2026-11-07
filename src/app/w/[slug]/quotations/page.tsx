import { dmy } from "@/lib/format/date";
import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listQuotations } from "@/lib/vendorflow/service";
import { PageHeader, Panel, Plate, money } from "@/components/ui";

export default function QuotationsPage({ params, searchParams }: PageProps<"/w/[slug]/quotations">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const LABEL: Record<string, string> = { submitted: "Awaiting a decision", approved: "Approved", rejected: "Rejected" };

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const status = typeof sp.status === "string" && LABEL[sp.status] ? sp.status : "submitted";
  const m = await requireMembership(slug, { fullScope: true });
  const cur = m.currency || "PKR";
  const rows = await listQuotations(getDriver(), m, { status });
  const chip = (on: boolean) => `rounded-full border px-4 py-1.5 text-sm ${on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"}`;
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Quotations" sub="What workshops have quoted. Open a job card to compare quotes and decide." />
      <nav className="flex flex-wrap gap-2" aria-label="Quotation status">
        {Object.entries(LABEL).map(([k, l]) => <a key={k} href={`/w/${slug}/quotations?status=${k}`} aria-current={k === status ? "page" : undefined} className={chip(k === status)}>{l}</a>)}
      </nav>
      <Panel flush>
        {rows.length === 0 ? <p className="p-5 text-sm text-zinc-500">Nothing here.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Job</th><th>Vehicle</th><th>Workshop</th><th>Quoted</th><th>Valid until</th><th>Days</th><th>Warranty</th><th className="px-5 text-right">Amount ({cur})</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100">
                <td className="px-5 py-3 font-medium"><a className="text-sky-800 hover:underline" href={`/w/${slug}/job-cards/${r.job_card_id}`}>{r.job_no}</a></td>
                <td className="py-3"><Plate>{r.registration_no}</Plate></td><td className="py-3">{r.vendor_name}</td>
                <td className="py-3">{dmy(r.created_at)}</td><td className="py-3">{r.valid_until ? dmy(r.valid_until) : "—"}</td>
                <td className="py-3">{r.days_needed ?? "—"}</td><td className="py-3">{r.warranty_months ? `${r.warranty_months} mo` : "—"}</td>
                <td className="px-5 py-3 text-right font-mono">{money(r.amount)}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Panel>
    </main>
  );
}
