import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { PageHeader, Panel, Pill, btn, type Tone } from "@/components/ui";
import { accessMessage, LOCK_TEXT } from "@/lib/billing/state";
import { formatPrice } from "@/lib/billing/offer";
import { listClaims, listInvoices, paymentReference, BILLING_PERMISSION } from "@/lib/billing/payments";
import { loadPlatformSettings } from "@/lib/billing/settings";
import { ClaimForm } from "./forms";

export default function BillingPage({ params }: PageProps<"/w/[slug]/billing">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const STATE: Record<string, { label: string; tone: Tone }> = {
  trial: { label: "Free trial", tone: "info" }, active: { label: "Subscribed", tone: "ok" }, grace: { label: "Payment overdue", tone: "warn" },
  ending: { label: "Ending", tone: "warn" }, locked: { label: "Locked", tone: "bad" }, comped: { label: "No charge", tone: "ok" },
};
const CLAIM: Record<string, { label: string; tone: Tone }> = { pending: { label: "Waiting for confirmation", tone: "warn" }, confirmed: { label: "Confirmed", tone: "ok" }, rejected: { label: "Not accepted", tone: "bad" } };
const dmy = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const minor = (v: string, cur: string) => formatPrice(Number(v), cur);

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug, { allowLocked: true });   // this is where a locked workspace lands
  const driver = getDriver();
  const perms = await permissionsOf(driver, m);
  const admin = perms.has(BILLING_PERMISSION);
  const a = m.billing!;
  const msg = accessMessage(a);
  const [settings, claims, invoices] = admin
    ? await Promise.all([loadPlatformSettings(driver), listClaims(driver, m), listInvoices(driver, m)])
    : [{} as Record<string, string>, [], []];
  const rate = Number(settings.pkr_per_usd);
  const usd = a.priceCents / 100;
  const pkr = a.currency === "USD" && rate > 0 ? Math.round(usd * rate) : null;
  const waiting = claims.find((c) => c.status === "pending");
  const st = STATE[a.state] ?? STATE.locked;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Billing" sub={`${m.tenantName ?? slug} · ${formatPrice(a.priceCents, a.currency)} per month`} actions={<a href={`/w/${slug}/export/vehicles`} className={btn}>Export my data</a>} />

      <Panel title="Your plan" action={<Pill tone={st.tone}>{st.label}</Pill>}>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div><dt className="text-zinc-500">Price</dt><dd className="mt-1 font-mono text-lg">{formatPrice(a.priceCents, a.currency)} <span className="font-sans text-sm text-zinc-500">a month</span></dd></div>
          <div><dt className="text-zinc-500">{a.state === "trial" ? "Trial ends" : a.state === "locked" ? "Locked since" : "Paid until"}</dt><dd className="mt-1">{a.until ? dmy(a.until) : "—"}{a.daysLeft !== null && a.state !== "locked" ? <span className="text-zinc-500"> ({a.daysLeft} {a.daysLeft === 1 ? "day" : "days"} left)</span> : null}</dd></div>
          <div><dt className="text-zinc-500">Your payment reference</dt><dd className="mt-1 font-mono text-lg">{paymentReference(m.tenantId)}</dd></div>
        </dl>
        {(msg || !a.full) && <p role="status" className={`mt-4 rounded-md border px-4 py-3 text-sm ${a.full ? "border-sky-200 bg-sky-100 text-sky-900" : "border-red-200 bg-red-50 text-red-900"}`}>{msg?.text ?? LOCK_TEXT[a.lockedReason ?? "no_subscription"]}</p>}
      </Panel>

      {!admin ? (
        <Panel title="Paying"><p className="text-sm text-zinc-600">Ask your workspace administrator to pay the subscription. They will see how on this page.</p></Panel>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
          <Panel title="How to pay" sub="By direct bank transfer">
            {settings.bank_details ? (
              <div className="space-y-4 text-sm">
                <ol className="list-decimal space-y-2 pl-5">
                  <li>Send <strong>{formatPrice(a.priceCents, a.currency)}</strong>{pkr ? <> (about <strong>Rs {pkr.toLocaleString("en-US")}</strong> at Rs {rate} to the dollar)</> : null} for each month you want to pay for, to this account:</li>
                  <li>Write <span className="font-mono font-semibold">{paymentReference(m.tenantId)}</span> in the transfer&apos;s reference or description.</li>
                  <li>Fill in the form on this page with the details from your bank&apos;s receipt.</li>
                </ol>
                <pre className="whitespace-pre-wrap rounded-md border border-zinc-200 bg-zinc-50 p-3 font-mono text-[13px] leading-6">{settings.bank_details}</pre>
                {settings.payment_note && <p className="whitespace-pre-wrap text-zinc-600">{settings.payment_note}</p>}
                {settings.support_email && <p className="text-zinc-500">Questions about billing: <a className="underline" href={`mailto:${settings.support_email}`}>{settings.support_email}</a></p>}
              </div>
            ) : <p className="text-sm text-zinc-600">Payment details have not been set up yet. {settings.support_email ? <>Write to <a className="underline" href={`mailto:${settings.support_email}`}>{settings.support_email}</a>.</> : "Please contact support."}</p>}
          </Panel>

          <Panel title="I have paid" sub={waiting ? undefined : "Tell us about your transfer so we can confirm it."}>
            {waiting ? (
              <div className="space-y-2 text-sm">
                <p><Pill tone="warn">Waiting for confirmation</Pill></p>
                <p>You told us on {dmy(waiting.created_at)} that you sent {minor(waiting.amount_minor, waiting.currency)} for {waiting.months} {waiting.months === 1 ? "month" : "months"} (reference {waiting.bank_reference}). We confirm payments when they appear in our bank, usually within one working day. You can send another one after this is decided.</p>
              </div>
            ) : <ClaimForm slug={slug} defaultAmount={String(usd)} defaultCurrency={a.currency === "PKR" ? "PKR" : "USD"} today={today} />}
          </Panel>

          <Panel title="Payments you have told us about" flush>
            {claims.length === 0 ? <p className="p-5 text-sm text-zinc-500">None yet.</p> : (
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Date</th><th>Amount</th><th>Reference</th><th className="px-5">Status</th></tr></thead>
                <tbody>{claims.map((c) => (
                  <tr key={c.id} className="border-t border-zinc-100 align-top">
                    <td className="px-5 py-3">{dmy(c.paid_on)}</td><td className="py-3 font-mono">{minor(c.amount_minor, c.currency)}</td><td className="py-3">{c.bank_reference}</td>
                    <td className="px-5 py-3"><Pill tone={CLAIM[c.status].tone}>{CLAIM[c.status].label}</Pill>{c.decision_note && <span className="mt-1 block text-xs text-zinc-500">{c.decision_note}</span>}</td>
                  </tr>))}</tbody>
              </table>
            )}
          </Panel>

          <Panel title="Invoices" flush>
            {invoices.length === 0 ? <p className="p-5 text-sm text-zinc-500">Invoices appear here once a payment is confirmed.</p> : (
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Invoice</th><th>Period</th><th className="px-5 text-right">Amount</th></tr></thead>
                <tbody>{invoices.map((i) => (
                  <tr key={i.id} className="border-t border-zinc-100">
                    <td className="px-5 py-3"><a className="text-sky-800 underline" href={`/w/${slug}/billing/invoices/${i.id}`}>{i.number}</a></td>
                    <td className="py-3">{dmy(i.period_start)} to {dmy(i.period_end)}</td><td className="px-5 py-3 text-right font-mono">{minor(i.amount_cents, i.currency)}</td>
                  </tr>))}</tbody>
              </table>
            )}
          </Panel>
        </div>
      )}
    </main>
  );
}
