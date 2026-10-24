import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { getDriver } from "@/lib/db";
import { loadOffer } from "@/lib/billing/offer";
import { signupsOpen } from "@/lib/orgs/runtime";
import { countryOptions } from "@/lib/orgs/countries";
import { SignupForm } from "./form";

export const metadata: Metadata = { title: "Start your free trial · Fleet OTG" };

export default function SignupPage() {
  return <Suspense fallback={<SiteShell active="signup"><p className="p-6 text-sm text-zinc-500">Loading</p></SiteShell>}><Inner /></Suspense>;
}

async function Inner() {
  await connection();
  const offer = await loadOffer(getDriver()).catch(() => null);
  const open = !!offer && signupsOpen();
  return (
    <SiteShell active="signup">
      <div className="mx-auto grid max-w-5xl gap-10 px-5 py-12 md:grid-cols-[1.2fr_1fr]">
        <section>
          <h1 className="text-3xl font-semibold">Start your free trial</h1>
          <p className="mt-2 text-zinc-600">{offer ? `${offer.trialDays} days, every feature, no card needed.` : "Create your company's workspace."}</p>
          <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-6">
            {open ? <SignupForm trialDays={offer!.trialDays} countries={countryOptions()} /> : (
              <p role="status" className="text-zinc-700">Sign-up is not open yet. Please check back soon, or <a href="/login" className="underline">sign in</a> if you already have an account.</p>
            )}
          </div>
        </section>
        <aside className="space-y-5 text-sm">
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="font-semibold">What happens next</h2>
            <ol className="mt-3 list-decimal space-y-2 pl-5 text-zinc-700">
              <li>You confirm your email address.</li>
              <li>We build your company&apos;s own workspace, kept apart from every other company&apos;s. It takes about a minute.</li>
              <li>You add vehicles and invite your team.</li>
              <li>{offer ? `After ${offer.trialDays} days, you choose whether to subscribe.` : "After the trial, you choose whether to subscribe."}</li>
            </ol>
          </div>
          {offer && (
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <p className="text-zinc-500">After the trial</p>
              <p className="mt-1"><span className="text-2xl font-semibold leading-tight">{offer.headline}</span> <span className="block text-zinc-500">{offer.per}</span></p>
              <p className="mt-2 text-zinc-600">Pay by bank transfer. If you do not subscribe, nothing is deleted at once: the workspace locks and you can still export your data.</p>
            </div>
          )}
        </aside>
      </div>
    </SiteShell>
  );
}
