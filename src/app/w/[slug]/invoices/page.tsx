import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listInvoices } from "@/lib/vendorflow/service";

export default function InvoicesPage({ params, searchParams }: PageProps<"/w/[slug]/invoices">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const LABEL: Record<string, string> = { submitted: "To check", verified: "Checked", disputed: "Returned", paid: "Paid" };

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const status = typeof sp.status === "string" && LABEL[sp.status] ? sp.status : "submitted";
  const m = await requireMembership(slug);
  const rows = await listInvoices(getDriver(), m, { status });
  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold">Invoices</h1>
      <nav className="flex gap-2 text-sm" aria-label="Invoice status">
        {Object.entries(LABEL).map(([k, l]) => (
          <a key={k} href={`/w/${slug}/invoices?status=${k}`} aria-current={k === status ? "page" : undefined}
            className={`rounded-md border px-3 py-2 ${k === status ? "border-sky-800 bg-sky-800 text-white" : "border-zinc-300 bg-white"}`}>{l}</a>
        ))}
      </nav>
      {rows.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600">Nothing here.</p> : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500"><tr><th className="p-3">Invoice</th><th className="p-3">Job</th><th className="p-3">Vehicle</th><th className="p-3">Vendor</th><th className="p-3">Date</th><th className="p-3 text-right">Amount</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                <td className="p-3 font-medium"><a className="text-sky-800 hover:underline" href={`/w/${slug}/invoices/${r.id}`}>{r.invoice_no}</a></td>
                <td className="p-3"><a className="text-sky-800 hover:underline" href={`/w/${slug}/job-cards/${r.job_card_id}`}>{r.job_no}</a></td>
                <td className="p-3">{r.registration_no}</td><td className="p-3">{r.vendor_name}</td><td className="p-3">{r.invoice_date}</td>
                <td className="p-3 text-right tabular-nums">{Number(r.amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
