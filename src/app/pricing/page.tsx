import { pageMeta } from "@/lib/site";
import { Suspense } from "react";
import { connection } from "next/server";
import { SiteShell } from "@/components/site-shell";
import { getDriver } from "@/lib/db";
import { loadOffer } from "@/lib/billing/offer";
import { loadProOffer } from "@/lib/billing/plans";
import { loadPlatformSettings } from "@/lib/billing/settings";
import { JsonLd } from "@/components/json-ld";
import { PRICING_FAQ } from "@/lib/faq";
import { breadcrumbLd, faqLd } from "@/lib/seo";
import { Icon } from "@/components/icons";
import { PageHero } from "@/components/page-hero";
import { SELLING_POINTS } from "@/lib/selling-points";
import { Art } from "@/components/art";

export const metadata = pageMeta("Pricing · Fleet OTG", "The price of Basic and Pro. Basic costs about one month's wage of an unskilled labourer; Pro costs less than a fleet manager's monthly salary. Free trial, no card needed.");

export default function PricingPage() {
  return <Suspense fallback={<SiteShell active="pricing"><p className="p-6 text-sm text-zinc-500">Loading</p></SiteShell>}><Inner /></Suspense>;
}

const STEPS: [string, string][] = [
  ["Start the trial", "Sign up with your company and email. Every feature is open, and no card is needed."],
  ["Choose to continue", "Before the trial ends, open Billing inside your workspace. It shows the price and how to pay."],
  ["Pay", "Follow the payment steps in Billing, then press \"I have paid\" and add your receipt or reference."],
  ["We confirm and invoice", "We check and confirm your payment, and your invoice appears in Billing. Your workspace stays open the whole time."],
];

async function Inner() {
  await connection();
  const [offer, settings, pro] = await Promise.all([loadOffer(getDriver()).catch(() => null), loadPlatformSettings(getDriver()).catch(() => ({} as Record<string, string>)), loadProOffer(getDriver()).catch(() => null)]);
  const sales = settings.sales_email?.trim();
  return (
    <SiteShell active="pricing">
      <JsonLd data={breadcrumbLd([["Fleet OTG", "/"], ["Pricing", "/pricing"]])} />
      <JsonLd data={faqLd(PRICING_FAQ)} />
      <PageHero eyebrow="Pricing" title="Basic, and Pro for larger fleets" chips={["No per-user charges", "Free trial, no card", "Export your data any time", "Pro: one price for every fleet size"]} art={<Art name="plans" />}>
        <p>Everything in Fleet OTG for your whole company, with no per-user charges. Basic has every core feature and is what every company starts on. Pro adds the AI that reads your workshops&apos; estimates and invoices for you.</p>
      </PageHero>
      <div className="mx-auto max-w-6xl 2xl:max-w-[96rem] px-5 py-12">
        <div className="grid gap-6 md:grid-cols-[1fr_1.3fr]">
          <div className="space-y-6">
          <section className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-[var(--shadow-card)]" aria-labelledby="plan">
            <h2 id="plan" className="text-sm font-medium text-zinc-500">Basic plan</h2>
            {offer ? (
              <>
                <p className="mt-2"><span className="text-4xl font-semibold leading-tight">{offer.amount}</span> <span className="block text-zinc-500">{offer.per}</span></p>
                <p className="mt-1 text-sm font-medium text-brand">{offer.headline}</p>
                <div className="mt-4 grid grid-cols-2 gap-2 text-sm" role="table" aria-label="Basic price by length of payment">
                  <div role="row" className="rounded-lg border border-zinc-200 p-3"><p className="text-zinc-500">1 month</p><p className="mt-1 text-lg font-semibold">{offer.amount}</p></div>
                  <div role="row" className="rounded-lg border border-brand bg-brand/5 p-3"><p className="text-zinc-500">12 months, one month free</p><p className="mt-1 text-lg font-semibold">{offer.yearly}</p></div>
                </div>
                <ul className="mt-4 space-y-2 text-sm text-zinc-700">{offer.points.map((p) => <li key={p} className="flex gap-2"><span aria-hidden className="mt-0.5 shrink-0 text-brand"><Icon name="approve" size={16} /></span>{p}</li>)}</ul>
                <a href="/signup" className="shine mt-6 block rounded-md bg-brand py-3 text-center font-semibold text-white hover:opacity-90">Start your {offer.trialDays}-day free trial</a>
                {sales && <p className="mt-3 text-center text-sm text-zinc-600">Questions first? Talk to sales: <a href={`mailto:${sales}`} className="font-medium text-brand underline">{sales}</a></p>}
              </>
            ) : <p className="mt-3 text-sm text-zinc-600">Pricing is not published yet. Please check back soon.</p>}
          </section>

          {pro && (
            <section className="rounded-2xl border-2 border-brand bg-white p-6 shadow-[var(--shadow-card)]" aria-labelledby="pro">
              <h2 id="pro" className="text-sm font-medium text-brand">Pro plan</h2>
              {pro.priced ? (
                <div className="mt-2">
                  <p className="text-sm font-medium text-brand">{pro.headline}</p>
                  <p className="mt-1 text-sm text-zinc-500">{pro.bands.length > 1 ? "Priced by the size of your fleet, " : "One price for every fleet size, "}{pro.per}</p>
                  <table className="mt-2 w-full text-left text-sm">
                    <thead className="text-zinc-500"><tr><th className="py-2 font-normal">Fleet size</th><th className="py-2 text-right font-normal">1 month</th><th className="py-2 text-right font-normal">12 months, one free</th></tr></thead>
                    <tbody>{pro.bands.map((b) => <tr key={b.label} className="border-t border-zinc-100"><td className="py-2">{b.label}</td><td className="py-2 text-right text-lg font-semibold">{b.amount}</td><td className="py-2 text-right text-lg font-semibold">{b.yearly}</td></tr>)}</tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-2 text-lg font-semibold">Coming in the second phase</p>
              )}
              <ul className="mt-4 space-y-2 text-sm text-zinc-700">{pro.points.map((p) => <li key={p} className="flex gap-2"><span aria-hidden className="mt-0.5 shrink-0 text-brand"><Icon name="approve" size={16} /></span>{p}</li>)}</ul>
              <p className="mt-5 text-sm text-zinc-600">Pro is for busy fleets. {pro.priced ? <>Any Basic company can try it free for 3 days, then pay for it in Billing; it starts when your current period ends. Questions? <a href="/contact" className="font-medium text-brand underline">Contact us</a>.</> : <>Want to hear when it opens? <a href="/contact" className="font-medium text-brand underline">Tell us</a>.</>}</p>
            </section>
          )}
          </div>

          <section aria-labelledby="pay">
            <p className="mb-6 rounded-xl border border-zinc-200 bg-white p-4 text-sm text-zinc-700">Want to see exactly what each plan includes? <a href="/compare" className="font-medium text-brand underline">Compare Basic and Pro</a>.</p>
            <h2 id="pay" className="text-xl font-semibold">How paying works</h2>
            <ol className="mt-4 space-y-4">
              {STEPS.map(([t, d], i) => (
                <li key={t} className="flex gap-4">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-side text-sm font-semibold text-white" aria-hidden>{i + 1}</span>
                  <span><span className="block font-medium">{t}</span><span className="block text-sm text-zinc-600">{d}</span></span>
                </li>))}
            </ol>
          </section>
        </div>

        <section className="mt-14" aria-labelledby="inc">
          <h2 id="inc" className="text-2xl font-semibold">What every company gets</h2>
          <ul className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {SELLING_POINTS.map((p) => (
              <li key={p.title} className="group rounded-2xl border border-zinc-200 bg-white p-4 shadow-[var(--shadow-card)]">
                <Art name={p.art} className="!shadow-none" />
                <p className="mt-4 px-1 font-semibold">{p.title}</p><p className="mt-1 px-1 pb-1 text-sm text-zinc-600">{p.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="mx-auto mt-14 max-w-3xl" aria-labelledby="faq">
          <h2 id="faq" className="text-2xl font-semibold">Common questions</h2>
          <div className="mt-6 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white text-sm">
            {PRICING_FAQ.map((f) => (
              <details key={f.q} className="group px-5 py-4 open:bg-zinc-50">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">{f.q}<span aria-hidden className="shrink-0 text-brand transition-transform group-open:rotate-45"><Icon name="plus" size={18} /></span></summary>
                <p className="mt-2 text-zinc-600">{f.a}</p>
              </details>
            ))}
            <div className="px-5 py-4"><p className="font-semibold">Already have a company code?</p><p className="mt-1 text-zinc-600"><a href="/join" className="underline">Join your company</a>.</p></div>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
