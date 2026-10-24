import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { getDriver } from "@/lib/db";
import { loadOffer } from "@/lib/billing/offer";

export const metadata: Metadata = { title: "Pricing · Fleet OTG" };

export default function PricingPage() {
  return <Suspense fallback={<SiteShell active="pricing"><p className="p-6 text-sm text-zinc-500">Loading</p></SiteShell>}><Inner /></Suspense>;
}

const STEPS: [string, string][] = [
  ["Start the trial", "Sign up with your company and email. Every feature is open, and no card is needed."],
  ["Choose to continue", "Before the trial ends, open Billing inside your workspace. It shows the price, our bank account and a payment reference that is yours alone."],
  ["Pay by bank transfer", "Transfer the amount and put your reference in the transfer note. Then press \"I have paid\" and add the receipt or the transfer number."],
  ["We confirm and invoice", "We check the payment against our bank, confirm it, and your invoice appears in Billing. Your workspace stays open the whole time."],
];

async function Inner() {
  await connection();
  const offer = await loadOffer(getDriver()).catch(() => null);
  return (
    <SiteShell active="pricing">
      <div className="mx-auto max-w-5xl px-5 py-12">
        <h1 className="text-3xl font-semibold">One plan, one price</h1>
        <p className="mt-2 max-w-2xl text-zinc-600">Everything in Fleet OTG for your whole company. No per-user charges and no extras to switch on.</p>

        <div className="mt-8 grid gap-6 md:grid-cols-[1fr_1.3fr]">
          <section className="rounded-xl border border-zinc-200 bg-white p-6" aria-labelledby="plan">
            <h2 id="plan" className="text-sm font-medium text-zinc-500">Standard plan</h2>
            {offer ? (
              <>
                <p className="mt-2"><span className="text-3xl font-semibold leading-tight">{offer.headline}</span> <span className="block text-zinc-500">{offer.per}</span></p>
                <ul className="mt-4 space-y-2 text-sm text-zinc-700">{offer.points.map((p) => <li key={p} className="flex gap-2"><span aria-hidden className="text-brand">✓</span>{p}</li>)}</ul>
                <a href="/signup" className="mt-6 block rounded-md bg-brand py-3 text-center font-semibold text-white hover:opacity-90">Start your {offer.trialDays}-day free trial</a>
              </>
            ) : <p className="mt-3 text-sm text-zinc-600">Pricing is not published yet. Please check back soon.</p>}
          </section>

          <section aria-labelledby="pay">
            <h2 id="pay" className="text-xl font-semibold">How paying works</h2>
            <ol className="mt-4 space-y-4">
              {STEPS.map(([t, d], i) => (
                <li key={t} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-side text-sm font-semibold text-white" aria-hidden>{i + 1}</span>
                  <span><span className="block font-medium">{t}</span><span className="block text-sm text-zinc-600">{d}</span></span>
                </li>))}
            </ol>
          </section>
        </div>

        <section className="mt-12 grid gap-6 text-sm md:grid-cols-2" aria-label="Common questions">
          <div><h3 className="font-semibold">What if we do not subscribe?</h3><p className="mt-1 text-zinc-600">After a short grace period the workspace locks. Nothing is deleted, and you can still sign in to export all your data.</p></div>
          <div><h3 className="font-semibold">Do you take cards?</h3><p className="mt-1 text-zinc-600">Not yet. Bank transfer works today; card payment will be added later.</p></div>
          <div><h3 className="font-semibold">Can my team and my workshops join?</h3><p className="mt-1 text-zinc-600">Yes, at no extra cost. Your administrator gives them a company code, or invites them by email, and approves who gets in.</p></div>
          <div><h3 className="font-semibold">Already have a company code?</h3><p className="mt-1 text-zinc-600"><a href="/join" className="underline">Join your company</a>, or <a href="/join/workshop" className="underline">join as a workshop</a>.</p></div>
        </section>
      </div>
    </SiteShell>
  );
}
