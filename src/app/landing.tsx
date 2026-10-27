import { SiteShell } from "@/components/site-shell";
import type { ReactNode } from "react";
import type { Offer } from "@/lib/billing/offer";
import { HeroScene } from "@/components/hero-scene";
import { Hero3D } from "@/components/hero-3d";
import { JsonLd } from "@/components/json-ld";
import { HOME_FAQ } from "@/lib/faq";
import { faqLd, softwareLd } from "@/lib/seo";

const FEATURES: [string, string][] = [
  ["Job cards with approval", "A driver or fleet officer raises the job. A manager approves it. Nobody approves their own."],
  ["Workshops and quotations", "Send the job to a workshop, compare the quotation to the invoice, and pay only what was approved."],
  ["Odometer by link", "Drivers send their monthly reading from a phone link. No app, no password."],
  ["Servicing that tells you what is due", "Set the rules once. See what is overdue, coming up, or has no history at all."],
  ["Budgets and flags", "See what each vehicle costs against its budget, and which ones keep coming back."],
  ["Papers and fines in one place", "Insurance, fitness, token tax, accidents and challans, with reminders before they expire."],
];

// A plain mark for each feature, drawn from text so there is nothing to download.
const ICON: Record<string, string> = {
  "Job cards with approval": "✓", "Workshops and quotations": "⚙", "Odometer by link": "↗",
  "Servicing that tells you what is due": "◷", "Budgets and flags": "▮", "Papers and fines in one place": "▤",
};

/** `price` is the price box. It is passed in so the rest of the page can be built ahead of time while the price (read from the
 *  plans table) is filled in separately. The trial length is not stated here for the same reason; the price box carries it. */
export function Landing({ price }: { price: ReactNode }) {
  return (
    <SiteShell>
      <JsonLd data={softwareLd()} />
      <JsonLd data={faqLd(HOME_FAQ)} />
      <section className="hero-bg relative flex items-center overflow-hidden text-white [@media(min-height:760px)]:min-h-[calc(100svh-4.5rem)]">
        <div aria-hidden className="hero-grid pointer-events-none absolute inset-0" />
        <Hero3D />
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-5 py-16 md:grid-cols-[1fr_1.05fr] md:py-24 [@media(max-height:640px)]:gap-6 [@media(max-height:640px)]:py-8 md:[@media(max-height:640px)]:py-8">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-[#C9D5DC]"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-badge" /> Your Fleet Maintenance Manager</p>
            <h1 className="mt-5 text-[40px] font-semibold leading-[1.08] md:text-5xl">Know what you&apos;re spending on your fleet&apos;s maintenance, <span className="text-badge">and why.</span></h1>
            <p className="mt-5 max-w-xl text-lg text-[#B6C6D0]">Maintenance for company fleets: job cards, approvals, workshops, budgets and servicing, in one place your whole team can use.</p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a href="/signup" className="shine rounded-md bg-badge px-6 py-3 text-base font-semibold text-side hover:opacity-90">Start your free trial</a>
              <a href="/login" className="inline-block py-2 text-[#C9D5DC] underline">I already have an account</a>
            </div>
            <p className="mt-4 text-sm text-[#8EA3B0]">No card needed. Your data stays yours, and you can export it at any time.</p>
          </div>
          <HeroScene />
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 pt-16" aria-label="Price">{price}</section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-semibold">What you get</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([t, d]) => (
            <div key={t} className="reveal lift rounded-2xl border border-zinc-200 bg-white p-6 shadow-[var(--shadow-card)]"><span aria-hidden className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-side text-base text-badge">{ICON[t]}</span><h3 className="font-semibold">{t}</h3><p className="mt-2 text-sm text-zinc-600">{d}</p></div>
          ))}
        </div>
      </section>

      <section className="border-y border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-14 md:grid-cols-3">
          {[["1", "Sign up", "Tell us your company and confirm your email. It takes about two minutes."], ["2", "We set up your own workspace", "Your company gets its own workspace, kept apart from every other company's, ready in under a minute."], ["3", "Add vehicles and invite your team", `Try everything during the free trial. Subscribe if it works for you; if not, export your data and leave.`]].map(([n, t, d]) => (
            <div key={n} className="flex gap-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-side font-semibold text-white">{n}</span><div><h3 className="font-semibold">{t}</h3><p className="mt-1 text-sm text-zinc-600">{d}</p></div></div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-16">
        <h2 className="text-2xl font-semibold">Questions</h2>
        <dl className="mt-6 space-y-6 text-sm">
          {HOME_FAQ.map((f) => <div key={f.q}><dt className="font-semibold">{f.q}</dt><dd className="mt-1 text-zinc-600">{f.a}</dd></div>)}
        </dl>
        <a href="/signup" className="mt-10 inline-block rounded-md bg-brand px-6 py-3 font-semibold text-white hover:opacity-90">Start your free trial</a>
      </section>
    </SiteShell>
  );
}

/** The price box, filled from the plan in the database. */
export function PriceBox({ offer }: { offer: Offer | null }) {
  return (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-[var(--shadow-card)]">
          <p className="text-sm font-medium text-zinc-500">One plan, everything included</p>
          {offer ? (
            <div className="mt-2 grid gap-6 md:grid-cols-[1.1fr_1fr] md:items-center">
              <div>
                <p><span className="text-3xl font-semibold leading-tight">{offer.headline}</span> <span className="block text-zinc-500">{offer.per}</span></p>
                <a href="/signup" className="shine mt-6 inline-block rounded-md bg-brand px-6 py-3 font-semibold text-white hover:opacity-90">Start free trial</a>
              </div>
              <ul className="space-y-2 text-sm">
                {offer.points.map((p) => <li key={p} className="flex gap-2"><span aria-hidden className="text-brand">✓</span>{p}</li>)}
              </ul>
            </div>
          ) : <p className="mt-3 text-sm text-zinc-600">Sign-up opens soon. Check back shortly, or sign in if you already have an account.</p>}
        </div>
  );
}

/** Shown in its place while the price is being read: the same box, empty. */
export function PriceBoxPlaceholder() {
  return <div aria-hidden className="h-64 rounded-2xl border border-zinc-200 bg-white shadow-[var(--shadow-card)]" />;
}
