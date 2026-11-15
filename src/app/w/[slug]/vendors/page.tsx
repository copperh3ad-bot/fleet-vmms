import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listVendors } from "@/lib/master/service";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { VendorForm, VendorStatusButton } from "./form";
import { RateForm, RemoveRate } from "./rates";
import { listProviderRates, RATE_BASIS } from "@/lib/trips/outsourced";
import { outsourcingOn } from "@/lib/trips/service";

export default function VendorsPage({ params }: PageProps<"/w/[slug]/vendors">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug, { fullScope: true });
  const rows = await listVendors(getDriver(), m);
  // Each organization's own reference rates for its logistics providers (ADR-078, a Pro feature).
  const pro = await outsourcingOn(getDriver(), m).catch(() => false);
  const rates = pro ? await listProviderRates(getDriver(), m).catch(() => []) : [];
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Vendors" sub={`${rows.length} workshops and logistics providers`} />
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel title="Workshops" flush>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Name</th><th>Type</th><th>Categories</th><th>Contact</th><th>Status</th><th /></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-zinc-500">No vendors yet.</td></tr>}
              {rows.map((v) => (
                <tr key={v.id} className="border-t border-zinc-100 align-top">
                  <td className="px-5 py-3 font-medium">{v.name}</td>
                  <td className="py-3">{v.kind === "logistics" ? "Logistics" : "Workshop"}</td>
                  <td className="py-3">{v.categories.join(", ") || "—"}</td>
                  <td className="py-3">{[v.contact, v.phone, v.email].filter(Boolean).join(" · ") || "—"}</td>
                  <td className="py-3"><Pill tone={v.status === "blocked" ? "bad" : "ok"}>{v.status === "blocked" ? "Blocked" : "Active"}</Pill></td>
                  <td className="space-y-2 py-3 pr-5">
                    <details><summary className="cursor-pointer text-sky-800">Edit</summary><div className="mt-2 w-72 max-w-[80vw]"><VendorForm slug={slug} vendor={v} /></div></details>
                    {pro && v.kind === "logistics" && (
                      <details><summary className="cursor-pointer text-sky-800">Rate card{rates.some((r) => r.vendor_id === v.id) ? ` (${rates.filter((r) => r.vendor_id === v.id).length})` : ""}</summary>
                        <div className="mt-2 w-72 max-w-[80vw] space-y-3">
                          <p className="text-xs text-zinc-600">Your own reference rates for {v.name}. They sit beside its quotes and never replace one.</p>
                          <ul className="space-y-1 text-sm">
                            {rates.filter((r) => r.vendor_id === v.id).map((r) => <li key={r.id} className="flex flex-wrap items-baseline gap-x-2"><span>{r.label}</span><span className="font-mono">{Number(r.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} {RATE_BASIS[r.basis]}</span>{r.notes && <span className="text-xs text-zinc-500">{r.notes}</span>}<RemoveRate slug={slug} rateId={r.id} /></li>)}
                          </ul>
                          <RateForm slug={slug} vendorId={v.id} />
                        </div>
                      </details>
                    )}
                    <VendorStatusButton slug={slug} id={v.id} status={v.status === "blocked" ? "active" : "blocked"} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Panel>
        <div className="space-y-5">
          <Panel title="Add a vendor"><VendorForm slug={slug} /></Panel>
        </div>
      </div>
    </main>
  );
}
