import { dmy } from "@/lib/format/date";
import { billedMonths } from "@/lib/billing/months";
import { Suspense } from "react";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listClaimsForOperator, previewClaimTax } from "@/lib/billing/operator";
import { fmtMinor } from "@/lib/billing/tax";
import { loadPlatformSettings } from "@/lib/billing/settings";
import { formatPrice } from "@/lib/billing/offer";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { confirmClaimAction, rejectClaimAction } from "../actions";
import { MiniForm, ProofLink } from "../forms";

export default function PaymentsPage({ searchParams }: PageProps<"/admin/payments">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner searchParams={searchParams} /></Suspense>;
}


async function Inner({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const op = await requireOperator();
  const view = sp.view === "confirmed" || sp.view === "rejected" ? sp.view : "pending";
  const [claims, settings] = await Promise.all([listClaimsForOperator(getDriver(), op.id, view), loadPlatformSettings(getDriver())]);
  const rate = Number(settings.pkr_per_usd);
  const previews = new Map(await Promise.all(claims.filter((c) => c.status === "pending").map(async (c) => [c.id, await previewClaimTax(getDriver(), op.id, c.id).catch(() => null)] as const)));
  const tab = (on: boolean) => `rounded-full border px-4 py-1.5 text-sm ${on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white hover:bg-zinc-50"}`;
  return (
    <main className="mx-auto max-w-5xl 2xl:max-w-6xl space-y-5 p-6 text-zinc-900">
      <PageHeader title="Payments" sub="Check each one against the bank before confirming" />
      <nav className="flex gap-2" aria-label="Payment status">
        {[["pending", "To check"], ["confirmed", "Confirmed"], ["rejected", "Rejected"]].map(([k, l]) => <a key={k} href={`/admin/payments?view=${k}`} className={tab(view === k)}>{l}</a>)}
      </nav>
      {claims.length === 0 && <p className="rounded-md border border-dashed border-zinc-300 bg-white p-6 text-sm text-zinc-500">No payments waiting.</p>}
      {claims.map((c) => {
        const expected = c.price_cents * billedMonths(c.months);
        const expectedPkr = c.billing_currency === "USD" && rate > 0 ? Math.round((expected / 100) * rate) : null;
        return (
          <Panel key={c.id} title={<a className="underline" href={`/admin/orgs/${c.tenant_id}`}>{c.org_name}</a>} sub={`Sent ${dmy(c.paid_on)} · filed ${dmy(c.created_at)}`}
            action={<Pill tone={c.status === "pending" ? "warn" : c.status === "confirmed" ? "ok" : "bad"}>{c.status}</Pill>}>
            <dl className="grid gap-4 text-sm sm:grid-cols-4">
              <div><dt className="text-zinc-500">The customer says they sent</dt><dd className="mt-1 font-mono text-base">{formatPrice(Number(c.amount_minor), c.currency)}</dd></div>
              <div><dt className="text-zinc-500">For</dt><dd className="mt-1">{c.months} {c.months === 1 ? "month" : "months"}</dd></div>
              <div><dt className="text-zinc-500">Expected</dt><dd className="mt-1 font-mono">{formatPrice(expected, c.billing_currency)}{expectedPkr ? <span className="block font-sans text-xs text-zinc-500">about Rs {expectedPkr.toLocaleString("en-US")}</span> : null}</dd></div>
              <div><dt className="text-zinc-500">Bank reference</dt><dd className="mt-1 break-all">{c.bank_reference}<span className="block text-xs text-zinc-500">they should have written {c.reference_code}</span></dd></div>
            </dl>
            {previews.get(c.id) && (() => {
              const t = previews.get(c.id)!, m = (n: number | string) => fmtMinor(n, t.currency), kept = t.whtIncomeMinor + t.whtSalesMinor;
              return (
                <div className="mt-4 rounded-md border border-zinc-200 bg-zinc-50 p-3 text-sm">
                  <p className="font-medium">Invoice this will make: {t.scenario ?? t.authority}{t.country ? ` (customer's country: ${t.country})` : ""}</p>
                  <dl className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
                    <div className="flex justify-between"><dt>Subtotal</dt><dd className="font-mono">{m(t.subtotalMinor)}</dd></div>
                    <div className="flex justify-between"><dt>{t.authority} {t.salesTaxPct}%</dt><dd className="font-mono">{m(t.salesTaxMinor)}</dd></div>
                    <div className="flex justify-between font-medium"><dt>Total</dt><dd className="font-mono">{m(t.totalMinor)}</dd></div>
                    {kept > 0 && <div className="flex justify-between"><dt>They keep back (income tax {m(t.whtIncomeMinor)}, sales tax {m(t.whtSalesMinor)})</dt><dd className="font-mono">{m(kept)}</dd></div>}
                    <div className="flex justify-between font-medium"><dt>Should arrive in the bank</dt><dd className="font-mono">{m(t.netExpectedMinor)}</dd></div>
                  </dl>
                  {t.fx && <p className="mt-2 text-xs text-zinc-600">Exchange rate used: {t.fx}</p>}
                  {t.against && <p className={`mt-2 ${t.against.state === "exact" ? "text-green-800" : "text-red-800"}`}>{t.against.state === "exact" ? "What they say they sent matches." : t.against.state === "short" ? `They say they sent ${m(-t.against.diffMinor)} less than that.` : `They say they sent ${m(t.against.diffMinor)} more than that.`}</p>}
                  {kept > 0 && <p className="mt-2 text-xs text-zinc-600">After confirming, collect their withholding certificate (Tax page), or issue one for them there.</p>}
                </div>
              );
            })()}
            {c.note && <p className="mt-3 text-sm text-zinc-600">Note: {c.note}</p>}
            {c.decision_note && <p className="mt-3 text-sm text-zinc-600">Decision note: {c.decision_note}</p>}
            {c.has_proof && <p className="mt-3 text-sm"><ProofLink claimId={c.id} /></p>}
            {c.status === "pending" && (
              <div className="mt-5 space-y-4 border-t border-zinc-100 pt-4">
                <MiniForm action={confirmClaimAction.bind(null, c.id)} fields={[{ name: "months", label: "Months to credit", type: "number", defaultValue: String(c.months), width: "w-24" }, { name: "note", label: "Note (optional)", width: "w-64" }]} button="It arrived: confirm" />
                <MiniForm action={rejectClaimAction.bind(null, c.id)} fields={[{ name: "note", label: "Why not (the customer sees this)", width: "w-96" }]} button="Reject" danger />
              </div>
            )}
          </Panel>
        );
      })}
    </main>
  );
}
