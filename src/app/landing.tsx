import { SiteShell } from "@/components/site-shell";
import type { Offer } from "@/lib/billing/offer";

const FEATURES: [string, string][] = [
  ["Job cards with approval", "A driver or fleet officer raises the job. A manager approves it. Nobody approves their own."],
  ["Workshops and quotations", "Send the job to a workshop, compare the quotation to the invoice, and pay only what was approved."],
  ["Odometer by link", "Drivers send their monthly reading from a phone link. No app, no password."],
  ["Servicing that tells you what is due", "Set the rules once. See what is overdue, coming up, or has no history at all."],
  ["Budgets and flags", "See what each vehicle costs against its budget, and which ones keep coming back."],
  ["Papers and fines in one place", "Insurance, fitness, token tax, accidents and challans, with reminders before they expire."],
];

export function Landing({ offer }: { offer: Offer | null }) {
  const days = offer?.trialDays ?? 3;
  return (
    <SiteShell>
      <section className="bg-side text-white">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-[1.2fr_1fr] md:py-24">
          <div>
            <h1 className="text-[40px] font-semibold leading-[1.1] md:text-5xl">Know what every vehicle costs, and why.</h1>
            <p className="mt-5 max-w-xl text-lg text-[#B6C6D0]">Maintenance for company fleets: job cards, approvals, workshops, budgets and servicing, in one place your whole team can use.</p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <a href="/signup" className="rounded-md bg-badge px-6 py-3 text-base font-semibold text-side hover:opacity-90">Start your {days}-day free trial</a>
              <a href="/login" className="text-[#C9D5DC] underline">I already have an account</a>
            </div>
            <p className="mt-4 text-sm text-[#8EA3B0]">No card needed. Your data stays yours, and you can export it at any time.</p>
          </div>
          <div className="rounded-xl bg-white p-6 text-zinc-900 shadow-lg" aria-label="Price">
            <p className="text-sm font-medium text-zinc-500">One plan, everything included</p>
            {offer ? (
              <>
                <p className="mt-2"><span className="text-3xl font-semibold leading-tight">{offer.headline}</span> <span className="block text-zinc-500">{offer.per}</span></p>
                <ul className="mt-5 space-y-2 text-sm">
                  {offer.points.map((p) => <li key={p} className="flex gap-2"><span aria-hidden className="text-brand">✓</span>{p}</li>)}
                </ul>
                <a href="/signup" className="mt-6 block rounded-md bg-brand py-3 text-center font-semibold text-white hover:opacity-90">Start free trial</a>
              </>
            ) : <p className="mt-3 text-sm text-zinc-600">Sign-up opens soon. Check back shortly, or sign in if you already have an account.</p>}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-16">
        <h2 className="text-2xl font-semibold">What you get</h2>
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([t, d]) => (
            <div key={t} className="rounded-xl border border-zinc-200 bg-white p-5"><h3 className="font-semibold">{t}</h3><p className="mt-2 text-sm text-zinc-600">{d}</p></div>
          ))}
        </div>
      </section>

      <section className="border-y border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-6xl gap-8 px-5 py-14 md:grid-cols-3">
          {[["1", "Sign up", "Tell us your company and confirm your email. It takes about two minutes."], ["2", "We set up your own workspace", "Your company gets its own workspace, kept apart from every other company's, ready in under a minute."], ["3", "Add vehicles and invite your team", `Try everything for ${days} days. Subscribe if it works for you; if not, export your data and leave.`]].map(([n, t, d]) => (
            <div key={n} className="flex gap-4"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-side font-semibold text-white">{n}</span><div><h3 className="font-semibold">{t}</h3><p className="mt-1 text-sm text-zinc-600">{d}</p></div></div>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-5 py-16">
        <h2 className="text-2xl font-semibold">Questions</h2>
        <dl className="mt-6 space-y-6 text-sm">
          <div><dt className="font-semibold">Is my data separate from other companies?</dt><dd className="mt-1 text-zinc-600">Yes. Every company&apos;s records are kept apart from every other company&apos;s. People from other companies cannot see them, and we check this with automated tests.</dd></div>
          <div><dt className="font-semibold">What happens after the trial?</dt><dd className="mt-1 text-zinc-600">The workspace locks until you subscribe. Nothing is deleted, and you can still export your data. We keep it for 30 days after a lock.</dd></div>
          <div><dt className="font-semibold">How do I pay?</dt><dd className="mt-1 text-zinc-600">By direct bank transfer for now. You send the transfer, upload the receipt, and we confirm it. Card payment is planned.</dd></div>
          <div><dt className="font-semibold">Do my drivers need accounts?</dt><dd className="mt-1 text-zinc-600">No. Drivers who only send odometer readings use a link from a message. Staff who approve, raise or review jobs sign in.</dd></div>
        </dl>
        <a href="/signup" className="mt-10 inline-block rounded-md bg-brand px-6 py-3 font-semibold text-white hover:opacity-90">Start your {days}-day free trial</a>
      </section>
    </SiteShell>
  );
}
