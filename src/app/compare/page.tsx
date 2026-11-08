import { Suspense } from "react";
import { connection } from "next/server";
import { pageMeta } from "@/lib/site";
import { SiteShell } from "@/components/site-shell";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, webPageLd } from "@/lib/seo";
import { PageHero, CtaBand } from "@/components/page-hero";
import { Icon } from "@/components/icons";
import { getDriver } from "@/lib/db";
import { loadOffer } from "@/lib/billing/offer";
import { loadProOffer } from "@/lib/billing/plans";
import { loadPlatformSettings } from "@/lib/billing/settings";
import { COMPARE } from "@/lib/plan-compare";

const TITLE = "Compare plans: Basic and Pro · Fleet OTG";
const DESCRIPTION = "What Basic and Pro include in Fleet OTG, side by side: job cards and approvals, workshops, servicing, costs, and the AI and WhatsApp features that come with Pro.";
export const metadata = pageMeta(TITLE, DESCRIPTION);

export default function ComparePage() {
  return <Suspense fallback={<SiteShell active="compare"><p className="p-6 text-sm text-zinc-500">Loading</p></SiteShell>}><Inner /></Suspense>;
}

function Mark({ yes, label }: { yes: boolean; label: string }) {
  return yes
    ? <span className="inline-flex text-brand" role="img" aria-label={`${label}: included`}><Icon name="approve" size={18} /></span>
    : <span className="text-zinc-400" role="img" aria-label={`${label}: not included`}>&mdash;</span>;
}

async function Inner() {
  await connection();
  // The prices are the owner's, read from the plans table; this page never states a figure of its own.
  const [offer, pro, settings] = await Promise.all([
    loadOffer(getDriver()).catch(() => null), loadProOffer(getDriver()).catch(() => null),
    loadPlatformSettings(getDriver()).catch(() => ({} as Record<string, string>)),
  ]);
  const sales = settings.sales_email?.trim();
  return (
    <SiteShell active="compare">
      <JsonLd data={webPageLd(TITLE, "/compare", DESCRIPTION)} />
      <JsonLd data={breadcrumbLd([["Fleet OTG", "/"], ["Compare plans", "/compare"]])} />
      <PageHero eyebrow="Compare plans" title="Basic and Pro, side by side">
        <p>Basic has every core feature of Fleet OTG except the AI and WhatsApp job cards, and is what every company starts on. Pro adds those two. Neither charges per user.</p>
      </PageHero>
      <div className="mx-auto max-w-6xl 2xl:max-w-[96rem] px-5 py-12">
        <div className="overflow-x-auto rounded-2xl border border-zinc-200 bg-white shadow-[var(--shadow-card)]">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <caption className="sr-only">What Basic and Pro include</caption>
            <thead>
              <tr className="border-b border-zinc-200 align-top">
                <th scope="col" className="w-1/2 px-5 py-5 text-zinc-500">Plan</th>
                <th scope="col" className="px-4 py-5">
                  <span className="block text-base font-semibold">Basic</span>
                  <span className="mt-1 block font-normal text-zinc-600">{offer ? <>{offer.headline} <span className="text-zinc-500">{offer.per}</span></> : "Pricing is not published yet"}</span>
                  {offer && <span className="mt-1 block font-normal text-zinc-500">{offer.trialDays}-day free trial</span>}
                </th>
                <th scope="col" className="px-4 py-5">
                  <span className="block text-base font-semibold text-brand">Pro</span>
                  <span className="mt-1 block font-normal text-zinc-600">{pro?.priced ? <>{pro.headline} <span className="text-zinc-500">{pro.per}</span></> : "Coming in the second phase"}</span>
                  <span className="mt-1 block font-normal text-zinc-500">Everything in Basic, plus AI and WhatsApp</span>
                </th>
              </tr>
            </thead>
            {COMPARE.map((g) => (
              <tbody key={g.title}>
                <tr className="bg-zinc-50"><th scope="colgroup" colSpan={3} className="px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">{g.title}</th></tr>
                {g.rows.map((r) => (
                  <tr key={r.feature} className="border-t border-zinc-100 align-top">
                    <th scope="row" className="px-5 py-3 font-medium text-zinc-900">{r.feature}{r.detail && <span className="mt-0.5 block text-[13px] font-normal text-zinc-600">{r.detail}</span>}</th>
                    <td className="px-4 py-3"><Mark yes={r.basic} label={`${r.feature}, Basic`} /></td>
                    <td className="px-4 py-3"><Mark yes={r.pro} label={`${r.feature}, Pro`} /></td>
                  </tr>
                ))}
              </tbody>
            ))}
            <tfoot>
              <tr className="border-t border-zinc-200">
                <td className="px-5 py-5" />
                <td className="px-4 py-5"><a href="/signup" className="shine inline-block rounded-md bg-brand px-4 py-2.5 text-center font-semibold text-white hover:opacity-90">{offer ? `Start your ${offer.trialDays}-day free trial` : "Start a free trial"}</a></td>
                <td className="px-4 py-5"><a href="/contact" className="inline-block rounded-md border border-zinc-300 px-4 py-2.5 text-center font-semibold hover:bg-zinc-50">Ask about Pro</a></td>
              </tr>
            </tfoot>
          </table>
        </div>
        <p className="mt-6 max-w-3xl text-sm text-zinc-600">
          Pro is for busy fleets: any Basic company can try it free for 3 days. The AI only ever makes a draft for a person to check, and the messages and files it reads are sent to Anthropic, our AI provider, which does not use them to train its models. For what each plan costs and how paying works, see <a href="/pricing" className="font-medium text-brand underline">Pricing</a>.
        </p>
      </div>
      <CtaBand title="Start with Basic. Move to Pro when you are ready.">
        <a href="/signup" className="shine rounded-md bg-badge px-5 py-3 font-semibold text-side hover:opacity-90">Start a free trial</a>
        {sales && <a href={`mailto:${sales}`} className="text-sm text-[#C9D5DC] underline">Talk to sales: {sales}</a>}
      </CtaBand>
    </SiteShell>
  );
}
