import { SiteShell } from "@/components/site-shell";
import type { ReactNode } from "react";
import type { Offer } from "@/lib/billing/offer";
import { HeroScene } from "@/components/hero-scene";
import { Hero3D } from "@/components/hero-3d";
import { FlowDemo } from "@/components/flow-demo";
import { Icon } from "@/components/icons";
import { Art } from "@/components/art";
import { JsonLd } from "@/components/json-ld";
import { HOME_FAQ } from "@/lib/faq";
import { PRO_HEADLINE } from "@/lib/billing/offer";
import { faqLd, softwareLd } from "@/lib/seo";
import { SELLING_POINTS } from "@/lib/selling-points";

type Feature = { title: string; text: string; icon: string; art: string; pro?: boolean };
const FEATURES: Feature[] = [
  { title: "Job cards with approval", text: "A driver or fleet officer raises the job. A manager approves it. Nobody approves their own.", icon: "approve", art: "approve" },
  { title: "Workshops and quotations", text: "Send the job to a workshop, compare the quotation to the invoice, and pay only what was approved.", icon: "workshop", art: "quote" },
  { title: "Odometer by link", text: "Drivers send their monthly reading from a phone link. No app, no password.", icon: "odometer", art: "phone" },
  { title: "Reminders that reach people", text: "Licences, insurance, fitness and token tax, and periodic maintenance due, in the app and by email to the vehicle holder and fleet managers.", icon: "bell", art: "bell" },
  { title: "Servicing that tells you what is due", text: "Set the rules once, by months, kilometres or engine hours. See what is overdue, coming up, or has no history.", icon: "service", art: "service" },
  { title: "Budgets and repeat-repair flags", text: "See what each vehicle and department costs against its budget, and which faults keep coming back.", icon: "budget", art: "budget" },
  { title: "Vehicle requests and departments", text: "HR requests a vehicle for an employee and a manager decides. Departments run their own vehicles under a spending limit.", icon: "users", art: "departments" },
  { title: "Papers, accidents and fines", text: "Insurance, fitness, token tax, accidents and challans in one place, each tied to the vehicle and who held it.", icon: "papers", art: "papers" },
  { title: "Trips, when you want them", text: "An optional module: request, approve and record a trip, with the odometer out and back.", icon: "car", art: "trip" },
  { title: "Cargo pick-ups and deliveries", text: "Staff ask for a cargo pick-up or delivery. The fleet manager accepts, schedules and follows it to delivery, or turns it into a trip.", icon: "car", art: "trip" },
  { title: "AI that reads workshop paperwork", text: "The AI fills in the form from an emailed estimate or invoice. A person always checks and saves.", icon: "spark", art: "ai", pro: true },
  { title: "Raise a job card on WhatsApp", text: "An employee sends one message, the AI drafts the job card, they confirm, and a manager approves in the app.", icon: "chat", art: "chat", pro: true },
  { title: "A WhatsApp menu for everyday requests", text: "Say Hi and choose: a job card, a cargo pick-up, a trip or an odometer reading. Cargo, trip and job card requests open as one short form with dropdowns, so the fleet manager gets complete information in a single message.", icon: "chat", art: "phone", pro: true },
  { title: "Quotes from logistics providers", text: "Send a trip to several providers, compare their quotes with your rate cards (the AI can advise), award one, and check their invoice.", icon: "car", art: "quote", pro: true },
];

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
        <div className="relative mx-auto grid w-full max-w-6xl 2xl:max-w-[96rem] items-center gap-12 px-5 py-16 md:grid-cols-[1fr_1.05fr] md:py-24 [@media(max-height:640px)]:gap-6 [@media(max-height:640px)]:py-8 md:[@media(max-height:640px)]:py-8">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-[#C9D5DC]"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-badge" /> Your Fleet Maintenance Manager</p>
            <h1 className="mt-5 text-[40px] font-semibold leading-[1.08] md:text-5xl">Know what you&apos;re spending on your fleet&apos;s maintenance, <span className="text-badge">and why.</span></h1>
            <p className="mt-5 max-w-xl text-lg text-[#B6C6D0]">Maintenance for company fleets: job cards, approvals, workshops, budgets, servicing and reminders in one place, reached from any phone, including WhatsApp.</p>
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

      <section className="mx-auto max-w-6xl 2xl:max-w-[96rem] px-5 pt-12" aria-label="What sets it apart">
        <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {SELLING_POINTS.map((p) => (
            <li key={p.title} className="reveal flex items-start gap-4 rounded-xl border border-zinc-200 bg-white/70 p-5">
              <span aria-hidden className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-badge text-side"><Icon name={p.icon} /></span>
              <div><p className="font-semibold">{p.title}</p><p className="mt-1 text-sm text-zinc-600">{p.text}</p></div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-6xl 2xl:max-w-[96rem] px-5 py-16" aria-labelledby="flow-h">
        <h2 id="flow-h" className="text-2xl font-semibold">See one repair, start to finish</h2>
        <p className="mt-2 max-w-2xl text-zinc-600">Pick a step, or let it play. This is the trail every job card leaves behind.</p>
        <div className="mt-8"><FlowDemo /></div>
      </section>

      <section className="mx-auto max-w-6xl 2xl:max-w-[96rem] px-5 pb-16">
        <h2 className="text-2xl font-semibold">What you get</h2>
        <p className="mt-2 max-w-2xl text-zinc-600">Everything below except the ones marked Pro is in Basic. <a href="/compare" className="font-medium text-zinc-900 underline">Compare Basic and Pro</a>.</p>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="group rounded-2xl border border-zinc-200 bg-white p-4 shadow-[var(--shadow-card)]">
              <div className="relative">
                <Art name={f.art} className="!shadow-none" />
                {f.pro && <span className="absolute right-3 top-3 rounded-full bg-badge px-2.5 py-0.5 text-xs font-semibold text-side">Pro</span>}
              </div>
              <h3 className="mt-4 flex items-center gap-2 px-1 font-semibold"><span aria-hidden className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-side text-badge transition-colors group-hover:bg-brand group-hover:text-white"><Icon name={f.icon} size={16} /></span>{f.title}</h3>
              <p className="mt-1.5 px-1 pb-1 text-sm text-zinc-600">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl 2xl:max-w-[96rem] px-5 pb-16" aria-labelledby="plans-h">
        <div className="grid items-center gap-8 rounded-3xl border border-zinc-200 bg-white p-6 shadow-[var(--shadow-card)] md:grid-cols-[1fr_1.1fr] md:p-10">
          <Art name="plans" />
          <div>
            <h2 id="plans-h" className="text-2xl font-semibold">Start with Basic. Add Pro when job cards pile up.</h2>
            <p className="mt-3 text-zinc-600">Basic has every core feature. Pro adds the AI that reads workshop paperwork, the WhatsApp menu for job cards, cargo, trips and odometer readings, and quotes from logistics providers. Any Basic company can try Pro free for 3 days.</p>
            <p className="mt-5 flex flex-wrap items-center gap-4"><a href="/pricing" className="shine inline-flex items-center gap-2 rounded-md bg-brand px-5 py-3 font-semibold text-white hover:opacity-90">See pricing <Icon name="arrow" /></a><a href="/compare" className="font-medium text-zinc-900 underline">Compare the plans</a></p>
          </div>
        </div>
      </section>

      <section className="border-y border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-6xl 2xl:max-w-[96rem] gap-8 px-5 py-14 md:grid-cols-3">
          {[["1", "Sign up", "Tell us your company and confirm your email. It takes about two minutes."], ["2", "We set up your own workspace", "Your company gets its own workspace, kept apart from every other company's, ready in under a minute."], ["3", "Add vehicles and invite your team", `Try everything during the free trial. Subscribe if it works for you; if not, export your data and leave.`]].map(([n, t, d]) => (
            <div key={n} className="flex gap-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-side font-semibold text-white">{n}</span><div><h3 className="font-semibold">{t}</h3><p className="mt-1 text-sm text-zinc-600">{d}</p></div></div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-16">
        <h2 className="text-2xl font-semibold">Questions</h2>
        <div className="mt-6 divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white text-sm">
          {HOME_FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-4 open:bg-zinc-50">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">{f.q}<span aria-hidden className="shrink-0 text-brand transition-transform group-open:rotate-45"><Icon name="plus" size={18} /></span></summary>
              <p className="mt-2 text-zinc-600">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="hero-bg relative overflow-hidden text-white" aria-label="Get started">
        <div aria-hidden className="hero-grid pointer-events-none absolute inset-0" />
        <div className="relative mx-auto flex max-w-6xl 2xl:max-w-[96rem] flex-wrap items-center justify-between gap-6 px-5 py-14">
          <div className="max-w-xl">
            <h2 className="text-3xl font-semibold uppercase">See where your maintenance money goes</h2>
            <p className="mt-2 text-[#B6C6D0]">Set up in about two minutes. No card needed to try it.</p>
          </div>
          <a href="/signup" className="shine inline-flex items-center gap-2 rounded-md bg-badge px-6 py-3 text-base font-semibold text-side hover:opacity-90">Start your free trial <Icon name="arrow" /></a>
        </div>
      </section>
    </SiteShell>
  );
}

/** The price box, filled from the plan in the database. */
export function PriceBox({ offer }: { offer: Offer | null }) {
  return (
        <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-[var(--shadow-card)]">
          <p className="text-sm font-medium text-zinc-500">Basic, with Pro when you need it</p>
          {offer ? (
            <div className="mt-2 grid gap-6 md:grid-cols-[1.1fr_1fr] md:items-center">
              <div>
                <p><span className="text-3xl font-semibold leading-tight">{offer.headline}</span> <span className="block text-zinc-500">{offer.per}</span></p>
                <p className="mt-3 text-sm text-zinc-600"><span className="font-semibold text-brand">Pro, for busy fleets:</span> {PRO_HEADLINE.toLowerCase()}. <a href="/pricing" className="underline">See pricing</a></p>
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
