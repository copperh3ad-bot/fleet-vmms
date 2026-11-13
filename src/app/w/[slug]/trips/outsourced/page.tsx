import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { outsourcedTripReport } from "@/lib/trips/outsourced";
import { tripsEnabled } from "@/lib/trips/service";
import { tripsClosedMessage } from "@/lib/billing/fleet-ops";
import { btn, PageHeader, Panel } from "@/components/ui";

export default function OutsourcedTripsPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ months?: string }> }) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const money = (v: string) => Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** What trips given to logistics providers cost, per provider (ADR-078). */
async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ months?: string }> }) {
  const { slug } = await params;
  const { months } = await searchParams;
  const m = await requireMembership(slug);
  const driver = getDriver();
  if (!(await tripsEnabled(driver, m))) return <main className="p-6 text-sm text-zinc-600">{await tripsClosedMessage(driver, m.tenantId, false)}</main>;
  const { rows, months: n } = await outsourcedTripReport(driver, m, Number(months) || 12);
  const sum = (k: "awarded" | "invoiced" | "payable" | "saved") => rows.reduce((a, r) => a + Number(r[k]), 0).toFixed(2);
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader crumb={<a href={`/w/${slug}/trips`} className="text-sky-800 hover:underline">Trips</a>} title="Outsourced trips" sub={`Trips given to logistics providers in the last ${n} months, by the day they were awarded`}
        actions={<a href={`/w/${slug}/export/outsourced-trips?months=${n}`} className={btn}>Download CSV</a>} />
      <nav aria-label="Period" className="flex flex-wrap gap-2 text-sm">
        {[3, 6, 12, 24].map((x) => <a key={x} href={`/w/${slug}/trips/outsourced?months=${x}`} aria-current={x === n ? "page" : undefined} className={`rounded-full border px-3 py-1 ${x === n ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white"}`}>{x} months</a>)}
      </nav>
      <Panel title="By provider" flush>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Provider</th><th className="text-right">Trips</th><th className="text-right">Awarded</th><th className="text-right">Invoiced</th><th className="text-right">Payable</th><th className="text-right">Saved by comparing</th><th className="px-5 text-right">Waiting for an invoice</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-zinc-500">No trips were given to a logistics provider in this period.</td></tr>}
            {rows.map((r) => (
              <tr key={r.vendor_name} className="border-t border-zinc-100">
                <td className="px-5 py-3 font-medium">{r.vendor_name}</td>
                <td className="py-3 text-right font-mono">{r.trips}</td>
                <td className="py-3 text-right font-mono">{money(r.awarded)}</td>
                <td className="py-3 text-right font-mono">{money(r.invoiced)}</td>
                <td className="py-3 text-right font-mono">{money(r.payable)}</td>
                <td className="py-3 text-right font-mono">{money(r.saved)}</td>
                <td className="px-5 py-3 text-right font-mono">{r.waiting_invoice}</td>
              </tr>
            ))}
            {rows.length > 1 && (
              <tr className="border-t-2 border-zinc-200 font-medium">
                <td className="px-5 py-3">All providers</td><td className="py-3 text-right font-mono">{rows.reduce((a, r) => a + r.trips, 0)}</td>
                <td className="py-3 text-right font-mono">{money(sum("awarded"))}</td><td className="py-3 text-right font-mono">{money(sum("invoiced"))}</td>
                <td className="py-3 text-right font-mono">{money(sum("payable"))}</td><td className="py-3 text-right font-mono">{money(sum("saved"))}</td><td className="px-5 py-3" />
              </tr>
            )}
          </tbody>
        </table></div>
      </Panel>
      <p className="text-xs text-zinc-500">Saved by comparing is the highest quote received for a trip minus the price awarded, counted only where more than one provider quoted. Payable is what Finance has checked; outsourced trips are not part of the vehicle cost reports because the vehicle is not yours.</p>
    </main>
  );
}
