import { dmy } from "@/lib/format/date";
import { Suspense } from "react";
import { forbidden } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { PageHeader, Panel, Pill, btn, type Tone } from "@/components/ui";
import { accessMessage, LOCK_TEXT } from "@/lib/billing/state";
import { formatPrice } from "@/lib/billing/offer";
import { billedMonths } from "@/lib/billing/months";
import { listClaims, listInvoices, paymentReference, BILLING_PERMISSION } from "@/lib/billing/payments";
import { loadPlatformSettings } from "@/lib/billing/settings";
import { getTaxProfile, quoteTax } from "@/lib/billing/tax-data";
import { planStatus } from "@/lib/billing/plan-switch";
import { type PlanPrice, ClaimForm, RequestBillForm, TryProButton, MoveToBasicButton, KeepProButton } from "./forms";
import { TaxProfileForm } from "./tax-form";

export default function BillingPage({ params }: PageProps<"/w/[slug]/billing">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const STATE: Record<string, { label: string; tone: Tone }> = {
  trial: { label: "Free trial", tone: "info" }, active: { label: "Subscribed", tone: "ok" }, grace: { label: "Payment overdue", tone: "warn" },
  ending: { label: "Ending", tone: "warn" }, locked: { label: "Locked", tone: "bad" }, comped: { label: "No charge", tone: "ok" },
};
const CLAIM: Record<string, { label: string; tone: Tone }> = { pending: { label: "Waiting for confirmation", tone: "warn" }, confirmed: { label: "Confirmed", tone: "ok" }, rejected: { label: "Not accepted", tone: "bad" } };
const minor = (v: string, cur: string) => formatPrice(Number(v), cur);

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug, { allowLocked: true, fullScope: true });   // this is where a locked workspace lands
  if (m.role === "vendor") forbidden();                            // a workshop is an outside party: it does not see the company's subscription, price or payment reference
  const driver = getDriver();
  const perms = await permissionsOf(driver, m);
  const admin = perms.has(BILLING_PERMISSION);
  const a = m.billing!;
  const msg = accessMessage(a);
  const [settings, claims, invoices, taxView, quote, plans] = admin
    ? await Promise.all([loadPlatformSettings(driver), listClaims(driver, m), listInvoices(driver, m), getTaxProfile(driver, m), quoteTax(driver, m, a.priceCents, a.currency, 1), planStatus(driver, m)])
    : [{} as Record<string, string>, [], [], null, null, null];
  const rate = Number(settings.pkr_per_usd);
  const usd = a.priceCents / 100;
  // The rupee hint is for customers in Pakistan (or not yet known) who have no tax quote above; a customer abroad pays in dollars and is not shown rupees.
  const country = taxView?.profile?.country ?? null;
  const pkr = !quote && (!country || country === "PK") && a.currency === "USD" && rate > 0 ? Math.round(usd * rate) : null;
  const waiting = claims.find((c) => c.status === "pending");
  const st = STATE[a.state] ?? STATE.locked;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Billing" sub={`${m.tenantName ?? slug} · ${formatPrice(a.priceCents, a.currency)} per month`} actions={<a href={`/w/${slug}/export/vehicles`} className={btn}>Export my data</a>} />

      <Panel title="Your plan" action={<Pill tone={st.tone}>{st.label}</Pill>}>
        <dl className="grid gap-4 break-words text-sm sm:grid-cols-3 [&>div]:min-w-0">
          <div><dt className="text-zinc-500">Price</dt><dd className="mt-1 font-mono text-lg">{formatPrice(a.priceCents, a.currency)} <span className="font-sans text-sm text-zinc-500">a month</span></dd></div>
          <div><dt className="text-zinc-500">{a.state === "trial" ? "Trial ends" : a.state === "locked" ? "Locked since" : "Paid until"}</dt><dd className="mt-1">{a.until ? dmy(a.until) : "—"}{a.daysLeft !== null && a.state !== "locked" ? <span className="text-zinc-500"> ({a.daysLeft} {a.daysLeft === 1 ? "day" : "days"} left)</span> : null}</dd></div>
          {admin && <div><dt className="text-zinc-500">Your payment reference</dt><dd className="mt-1 break-all font-mono text-lg">{paymentReference(m.tenantId)}</dd></div>}
        </dl>
        {(msg || !a.full) && <p role="status" className={`mt-4 rounded-md border px-4 py-3 text-sm ${a.full ? "border-sky-200 bg-sky-100 text-sky-900" : "border-red-200 bg-red-50 text-red-900"}`}>{msg?.text ?? LOCK_TEXT[a.lockedReason ?? "no_subscription"]}</p>}
      </Panel>

      {plans && (
        <Panel title="Basic and Pro" sub="Pay for the plan you want. Pro starts when your current paid period ends.">
          <div className="space-y-4 text-sm">
            <dl className="grid gap-4 sm:grid-cols-3 [&>div]:min-w-0">
              <div><dt className="text-zinc-500">Your plan</dt><dd className="mt-1 text-lg font-semibold">{plans.planKey === "pro" ? "Pro" : "Basic"}</dd></div>
              {plans.options.map((o) => <div key={o.key}><dt className="text-zinc-500">{o.key === "pro" ? "Pro" : "Basic"} costs</dt><dd className="mt-1 font-mono text-lg">{formatPrice(o.priceCents, o.currency)} <span className="font-sans text-sm text-zinc-500">a month</span><span className="mt-1 block font-sans text-sm text-zinc-600">or {formatPrice(o.priceCents * billedMonths(12), o.currency)} for 12 months, one month free</span></dd></div>)}
            </dl>
            {plans.pending && (
              <p role="status" className="rounded-md border border-sky-200 bg-sky-100 px-4 py-3 text-sky-900">
                {plans.pending.key === "pro" ? <>Your payment for Pro is confirmed. Pro starts on <strong>{dmy(plans.pending.from)}</strong>, when your Basic period ends.</> : <>You will move to Basic on <strong>{dmy(plans.pending.from)}</strong>, when your paid period ends. Pro works until then.</>}
              </p>
            )}
            {plans.proTrial?.running && <p role="status" className="rounded-md border border-sky-200 bg-sky-100 px-4 py-3 text-sky-900">Your free Pro trial ends on <strong>{dmy(plans.proTrial.endsAt)}</strong>. To keep Pro after that, pay for Pro below; it then starts when your current period ends.</p>}
            {plans.proTrial && !plans.proTrial.running && plans.planKey === "standard" && <p className="text-zinc-600">Your free Pro trial has ended. Pay for Pro below to have it again.</p>}
            <div className="flex flex-wrap gap-3">
              {plans.canTryPro && <TryProButton slug={slug} />}
              {plans.canMoveToBasic && <MoveToBasicButton slug={slug} />}
              {plans.pending?.key === "standard" && <KeepProButton slug={slug} />}
            </div>
          </div>
        </Panel>
      )}

      {!admin ? (
        <Panel title="Paying"><p className="text-sm text-zinc-600">Ask your workspace administrator to pay the subscription. They will see how on this page.</p></Panel>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
          <Panel title="How to pay">
            <div className="space-y-3 text-sm">
              <p>Send <strong>{formatPrice(a.priceCents, a.currency)}</strong>{pkr ? <> (about <strong>Rs {pkr.toLocaleString("en-US")}</strong>)</> : null} for each month you want to pay for. Pay for 12 months at once and the twelfth month is free: you pay for 11.</p>
              {settings.bank_details?.trim() ? <><p className="text-zinc-600">Press the button and we email you the bill with the bank account to pay into.</p><RequestBillForm slug={slug} /></> : <p className="text-zinc-600">Payment details have not been set up yet.</p>}
              <p>Write your payment reference <span className="font-mono font-semibold">{paymentReference(m.tenantId)}</span>, then fill in the form on this page once you have paid.</p>
              {settings.payment_note && <p className="whitespace-pre-wrap text-zinc-600">{settings.payment_note}</p>}
            </div>
          </Panel>

          <Panel title="I have paid" sub={waiting ? undefined : "Tell us about your transfer so we can confirm it."}>
            {waiting ? (
              <div className="space-y-2 text-sm">
                <p><Pill tone="warn">Waiting for confirmation</Pill></p>
                <p>You told us on {dmy(waiting.created_at)} that you sent {minor(waiting.amount_minor, waiting.currency)} for {waiting.months} {waiting.months === 1 ? "month" : "months"} (reference {waiting.bank_reference}). We confirm payments when they appear in our bank, usually within one working day. You can send another one after this is decided.</p>
              </div>
            ) : <ClaimForm slug={slug} defaultAmount={String(usd)} defaultCurrency={a.currency === "PKR" ? "PKR" : "USD"} today={today} plans={(plans?.options ?? []).filter((o) => !(plans?.pending?.key === "pro" && o.key === "standard")).map((o): PlanPrice => ({ key: o.key, label: o.key === "pro" ? "Pro" : "Basic", cents: o.priceCents, currency: o.currency }))} defaultPlan={plans?.pending?.key ?? plans?.planKey ?? "standard"} />}
          </Panel>

          {taxView && (
            <Panel title="Your company details" sub="For the invoice we issue to you. We need your registered company name and your NTN before we can issue it.">
              <TaxProfileForm slug={slug} profile={taxView.profile} />
            </Panel>
          )}

          <Panel title="Payments you have told us about" flush>
            {claims.length === 0 ? <p className="p-5 text-sm text-zinc-500">None yet.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Date</th><th>Amount</th><th>Reference</th><th className="px-5">Status</th></tr></thead>
                <tbody>{claims.map((c) => (
                  <tr key={c.id} className="border-t border-zinc-100 align-top">
                    <td className="px-5 py-3">{dmy(c.paid_on)}</td><td className="py-3 font-mono">{minor(c.amount_minor, c.currency)}</td><td className="py-3">{c.bank_reference}</td>
                    <td className="px-5 py-3"><Pill tone={CLAIM[c.status].tone}>{CLAIM[c.status].label}</Pill>{c.decision_note && <span className="mt-1 block text-xs text-zinc-500">{c.decision_note}</span>}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Panel>

          <Panel title="Invoices" flush>
            {invoices.length === 0 ? <p className="p-5 text-sm text-zinc-500">Invoices appear here once a payment is confirmed.</p> : (
              <div className="overflow-x-auto"><table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Invoice</th><th>Period</th><th className="px-5 text-right">Amount</th></tr></thead>
                <tbody>{invoices.map((i) => (
                  <tr key={i.id} className="border-t border-zinc-100">
                    <td className="px-5 py-3"><a className="text-sky-800 underline" href={`/w/${slug}/billing/invoices/${i.id}`}>{i.number}</a></td>
                    <td className="py-3">{dmy(i.period_start)} to {dmy(i.period_end)}</td><td className="px-5 py-3 text-right font-mono">{minor(i.amount_cents, i.currency)}</td>
                  </tr>))}</tbody>
              </table></div>
            )}
          </Panel>
        </div>
      )}
    </main>
  );
}
