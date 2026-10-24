import { pageMeta } from "@/lib/site";
import { SiteShell } from "@/components/site-shell";

export const metadata = pageMeta("About us · Fleet OTG", "Why Fleet OTG exists: the everyday problems of running a company fleet on spreadsheets, and what we built to end them.");

// Each block is a problem we met first-hand, and the thing in the product that answers it. Nothing here is a statistic or a
// customer claim: every answer names something the product does today.
const PAINS: { problem: string; story: string; answer: string }[] = [
  {
    problem: "The fleet lived in spreadsheets and phone calls",
    story: "A vehicle went to the workshop, someone rang to ask how it was going, someone else updated a cell, and nobody could say which version was true. Finding out what a vehicle had cost meant opening several files.",
    answer: "Every repair is one job card with a clear status and a full history of who did what and when. Nobody has to ask where it stands.",
  },
  {
    problem: "Nobody knew why the same vehicle kept breaking",
    story: "The same truck came back for the same fault, and the records could not show it. A bad part, a bad repair, rough driving and plain wear all looked like one more line of cost.",
    answer: "Each job records a reason, and repeat repairs on the same vehicle are flagged. You can see what keeps failing, and why.",
  },
  {
    problem: "The cost belonged to no one",
    story: "Repair bills landed on the company, not on the vehicle or on the person who had it at the time. Budgets were guesses, and overspending showed up at year end.",
    answer: "Cost is counted per vehicle and per period against its budget. Because we keep who held each vehicle and when, a cost lands on whoever had it at the time.",
  },
  {
    problem: "Approvals happened in chat, with no record",
    story: "A manager said yes on a call or a message. Later no one could show who approved a repair, for how much, or whether the person asking also approved it.",
    answer: "Approval is a step in the job card, recorded with the person and the time. Whoever raises a request cannot approve their own.",
  },
  {
    problem: "Workshop quotes and invoices went unchecked",
    story: "A quote came in, work started, and the invoice that arrived did not match either. Checking took phone calls to the workshop, and it often was not done.",
    answer: "Workshops send quotes through the system. The approved quote and the invoice sit on the same job card, and the invoice is verified as its own step before the card is closed.",
  },
  {
    problem: "Papers expired without anyone noticing",
    story: "Registration, fitness, insurance and route permits all have dates. One lapsed, and the first sign was a fine or a vehicle that could not go on the road.",
    answer: "Every document has an expiry date, and what is running out is listed ahead of time, per vehicle.",
  },
  {
    problem: "Chasing drivers for the odometer reading every month",
    story: "Mileage drives servicing, but getting it meant calling or messaging each driver and typing the answers in by hand.",
    answer: "Each driver gets a link on their phone. They enter the reading and nothing else: no app, no password. Unusual readings are held for review.",
  },
  {
    problem: "Accidents and fines got lost",
    story: "Accident details and traffic challans lived in different places, and a fine could be paid late or sit with the wrong driver.",
    answer: "Accidents and challans are records tied to the vehicle and the person who held it, with their status and cost.",
  },
];

export default function AboutPage() {
  return (
    <SiteShell active="about">
      <div className="mx-auto max-w-3xl px-5 py-12">
        <h1 className="text-3xl font-semibold">Built by people who ran a fleet on spreadsheets</h1>
        <p className="mt-4 text-lg text-zinc-700">Fleet OTG began inside a company that kept its vehicles on the road with spreadsheets, phone calls and follow-ups. It worked until it did not, and it stopped working in the same few places every time. This page lists those places, and what we built for each.</p>

        <div className="mt-10 space-y-8">
          {PAINS.map((p, i) => (
            <section key={p.problem} aria-labelledby={`pain-${i}`} className="rounded-xl border border-zinc-200 bg-white p-6">
              <h2 id={`pain-${i}`} className="text-xl font-semibold">{p.problem}</h2>
              <p className="mt-2 text-zinc-700">{p.story}</p>
              <p className="mt-3 border-l-4 border-brand pl-4 text-zinc-900"><span className="font-medium">What Fleet OTG does:</span> {p.answer}</p>
            </section>
          ))}
        </div>

        <section aria-labelledby="how" className="mt-12">
          <h2 id="how" className="text-2xl font-semibold">How we work</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-zinc-700">
            <li><span className="font-medium text-zinc-900">Your data stays yours.</span> Each company&apos;s records are kept apart from every other company&apos;s, and you can export everything at any time, even if your subscription lapses.</li>
            <li><span className="font-medium text-zinc-900">Everyone on one page.</span> Drivers, managers, workshops and finance each see what they need, and nothing more.</li>
            <li><span className="font-medium text-zinc-900">Simple pricing.</span> One plan with everything included, priced about the same as one month&apos;s wage of an unskilled labourer. No charge per user, and a free trial first.</li>
          </ul>
        </section>

        <section aria-labelledby="try" className="mt-12 rounded-xl bg-side p-8 text-white">
          <h2 id="try" className="text-2xl font-semibold">See whether it fits your fleet</h2>
          <p className="mt-2 text-[#C9D5DC]">Start the free trial, with every feature open and no card needed. Bring a few vehicles and one real repair.</p>
          <p className="mt-5 flex flex-wrap gap-3">
            <a href="/signup" className="rounded-md bg-badge px-6 py-3 font-semibold text-side hover:opacity-90">Start your free trial</a>
            <a href="/pricing" className="rounded-md border border-[#46606F] px-6 py-3 font-medium text-white hover:bg-white/10">See pricing</a>
          </p>
        </section>
      </div>
    </SiteShell>
  );
}
