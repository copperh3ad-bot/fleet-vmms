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
  { title: "Every repair approved, on record", text: "A driver or fleet officer raises the job. A manager approves it. Nobody approves their own, and every step keeps a name and a time.", icon: "approve", art: "approve" },
  { title: "Pay only what you approved", text: "Send the job to a workshop, compare its quotation with its invoice, and catch the extra lines before you pay them.", icon: "workshop", art: "quote" },
  { title: "Odometer readings without chasing", text: "Drivers send their monthly reading from a phone link. No app, no password, no reminding them.", icon: "odometer", art: "phone" },
  { title: "Hear it before it lapses", text: "Licences, insurance, fitness and token tax, and periodic maintenance due, in the app and by email to the vehicle holder and fleet managers.", icon: "bell", art: "bell" },
  { title: "Know which vehicles are overdue", text: "Set the servicing rules once, by months, kilometres or engine hours. See at a glance what is overdue, what is coming up, and what has no history at all.", icon: "service", art: "service" },
  { title: "Catch money leaks early", text: "See what each vehicle and department costs against its budget, and which faults keep coming back and costing you again.", icon: "budget", art: "budget" },
  { title: "Control who gets a vehicle", text: "HR requests a vehicle for an employee and a manager decides. Departments run their own vehicles under a spending limit.", icon: "users", art: "departments" },
  { title: "Papers, accidents and fines in one place", text: "Insurance, fitness, token tax, accidents and challans, each tied to the vehicle and to who held it. No more hunting through drawers and chats.", icon: "papers", art: "papers" },
  { title: "Make your policy actually enforced", text: "Keep the policy with every version. The app applies it for you: when a vehicle is due for replacement, which accidents the company covers, the driver's share of a repair.", icon: "papers", art: "papers" },
  { title: "Know which workshop deserves your business", text: "Days taken, quotation against the final bill, and how often work comes back, with your agreed rates for each workshop.", icon: "workshop", art: "workshop" },
  { title: "Find out why it keeps breaking", text: "Jobs by reason, driver, vehicle or workshop, days in the workshop, and cost per kilometre, engine hour and driver.", icon: "service", art: "repeat" },
  { title: "Everyone sees only what they should", text: "Administrator, fleet manager, finance, HR and a read-only auditor. A driver sees only their own vehicle and its job cards.", icon: "shield", art: "shield" },
  { title: "End the phone calls for pool cars", text: "Request, approve and schedule a trip with a vehicle and a driver, with the odometer out and back.", icon: "car", art: "trip", pro: true },
  { title: "Cargo moves without the chasing", text: "Staff ask for a cargo pick-up or delivery. The fleet manager accepts, schedules and follows it to delivery, or turns it into a trip.", icon: "car", art: "trip", pro: true },
  { title: "Stop typing workshop paperwork", text: "The AI fills in the form from an emailed estimate or invoice. A person always checks and saves.", icon: "spark", art: "ai", pro: true },
  { title: "A fault reported in one WhatsApp message", text: "An employee sends one message, the AI drafts the job card, they confirm, and a manager approves in the app.", icon: "chat", art: "chat", pro: true },
  { title: "Your team asks for things on WhatsApp", text: "Say Hi and choose: a job card, a cargo pick-up, a trip or an odometer reading. A few short questions each, so the fleet manager gets complete information. Coming soon: one short form with dropdowns for each request.", icon: "chat", art: "phone", pro: true },
  { title: "Get the best price from outside transport", text: "Send a trip to several providers, compare their quotes with your rate cards (the AI can advise), award one, and check their invoice.", icon: "car", art: "quote", pro: true },
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
            <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-[#C9D5DC]"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-badge" /> Built for company fleets in Pakistan</p>
            <h1 className="mt-5 text-[40px] font-semibold leading-[1.08] md:text-5xl">Every rupee your fleet spends on repairs, <span className="text-badge">accounted for.</span></h1>
            <p className="mt-5 max-w-xl text-lg text-[#B6C6D0]">Stop paying workshop bills nobody checked. Fleet OTG puts every repair on one job card, approved by a named person, compared with the workshop&apos;s quotation, and counted against the right vehicle. Your drivers and workshops need no app. They use a link on their phone.</p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a href="/signup" className="shine rounded-md bg-badge px-6 py-3 text-base font-semibold text-side hover:opacity-90">Start your free trial</a>
              <a href="/features" className="inline-block py-2 text-[#C9D5DC] underline">See how it works</a>
              <a href="/login" className="inline-block py-2 text-[#C9D5DC] underline">I already have an account</a>
            </div>
            <p className="mt-4 text-sm text-[#8EA3B0]">No card needed. Set up in about two minutes. Your data stays yours, and you can export it at any time.</p>
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
        <h2 id="flow-h" className="text-2xl font-semibold">One repair. Every step answerable.</h2>
        <p className="mt-2 max-w-2xl text-zinc-600">When someone asks who approved this, what was quoted and what was paid, the answer is already on the job card. Pick a step, or let it play.</p>
        <div className="mt-8"><FlowDemo /></div>
      </section>

      <section className="mx-auto max-w-6xl 2xl:max-w-[96rem] px-5 pb-16">
        <h2 className="text-2xl font-semibold">Everything between a breakdown and a paid invoice, under control</h2>
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
            <h2 id="plans-h" className="text-2xl font-semibold">Fix the repair bill first. Run the whole fleet when you are ready.</h2>
            <p className="mt-3 text-zinc-600">Basic gives you control of maintenance, with every core feature. Pro runs the rest of the fleet too: trip scheduling, cargo requests, quotes from logistics providers, the AI that reads workshop paperwork, and the WhatsApp menu. Any Basic company can try Pro free for 3 days.</p>
            <p className="mt-5 flex flex-wrap items-center gap-4"><a href="/pricing" className="shine inline-flex items-center gap-2 rounded-md bg-brand px-5 py-3 font-semibold text-white hover:opacity-90">See pricing <Icon name="arrow" /></a><a href="/compare" className="font-medium text-zinc-900 underline">Compare the plans</a></p>
          </div>
        </div>
      </section>

      <section className="border-y border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-6xl 2xl:max-w-[96rem] gap-8 px-5 py-14 md:grid-cols-3">
          {[["1", "Sign up in two minutes", "Tell us your company and confirm your email. No card needed."], ["2", "Your own workspace, ready at once", "Your company gets its own workspace, kept apart from every other company's, ready in under a minute."], ["3", "Add your vehicles and see the difference", `Try everything during the free trial. Subscribe if it earns its place; if not, export your data and leave. Nothing to lose.`]].map(([n, t, d]) => (
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
            <h2 className="text-3xl font-semibold uppercase">Your next workshop bill is coming. Will you know if it is right?</h2>
            <p className="mt-2 text-[#B6C6D0]">Try Fleet OTG free. Set up in about two minutes, no card needed.</p>
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
