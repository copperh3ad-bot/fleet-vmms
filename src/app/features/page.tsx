import { pageMeta } from "@/lib/site";
import { SiteShell } from "@/components/site-shell";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, webPageLd } from "@/lib/seo";

const TITLE = "Fleet maintenance software features · Fleet OTG";
const DESCRIPTION = "How Fleet OTG handles fleet maintenance: job cards with recorded approvals, workshop quotations checked against invoices, servicing, budgets and vehicle papers.";
export const metadata = pageMeta(TITLE, DESCRIPTION);

// Static text (ADR-031). Each block is a problem a company with a fleet meets, and the thing in the product that answers it today.
// Nothing here is a statistic, a customer claim or a price.
const SOLVES: { problem: string; answer: string }[] = [
  { problem: "Nobody can say who approved a repair", answer: "Job cards, quotations and invoices are approved with the person's name and the time. Whoever raises a request cannot approve it, and every step is recorded." },
  { problem: "Repair history is scattered across spreadsheets and chats", answer: "Each repair is one job card with a clear status and a full history of who did what and when. Drivers and fleet officers raise jobs, and managers approve them." },
  { problem: "Workshop quotations and invoices do not match", answer: "A workshop sends its estimate through a one-time link on its own phone number, recorded against the job card number. The invoice is checked against the approved quotation before payment, and not by the person who approved the job." },
  { problem: "Drivers need an account just to report a reading", answer: "Drivers send their monthly odometer reading from a phone link. There is no app and no password, and the link works once." },
  { problem: "Nobody knows what each vehicle costs", answer: "Spend is counted per vehicle and per period against its budget, and follows whoever held the vehicle at the time." },
  { problem: "The same fault keeps coming back", answer: "Every job records a reason, and a repeat repair on the same vehicle is flagged, so you can see what keeps failing and why." },
  { problem: "Servicing and papers are missed", answer: "Set the servicing rules once and see what is overdue, coming up, or has no history at all. Insurance, fitness, token tax, accidents and fines are kept in one place with reminders before they expire." },
  { problem: "Employees borrow each other's logins", answer: "Every sign-in is tied to an employee code and a role, so each action traces to a real person. Drivers who only report readings need no account." },
];

const STEPS: [string, string][] = [
  ["Raise the job", "A driver or fleet officer opens a job card for a vehicle and says what is wrong."],
  ["Approve it", "A manager approves the job. The approval is recorded with the person and the time."],
  ["Send it to a workshop", "The job goes to a workshop, which receives a link on its phone number to send its estimate."],
  ["Compare the quotation", "The estimate is recorded against the job card number and approved before work starts."],
  ["Check the invoice", "The workshop's invoice is checked against the approved quotation."],
  ["Close and count the cost", "The job closes, and its cost lands on the vehicle and its budget."],
];

export default function FeaturesPage() {
  return (
    <SiteShell active="features">
      <JsonLd data={webPageLd(TITLE, "/features", DESCRIPTION)} />
      <JsonLd data={breadcrumbLd([["Fleet OTG", "/"], ["Features", "/features"]])} />
      <article className="mx-auto max-w-4xl px-5 py-12">
        <h1 className="text-3xl font-semibold">Fleet maintenance management software, built around the job card</h1>
        <p className="mt-4 max-w-3xl text-lg text-zinc-700">Fleet OTG is fleet maintenance management software for companies that run their own vehicles. Every repair becomes one job card with a recorded approval trail, so you can see what each vehicle costs, who approved the work, and what is coming due.</p>

        <section className="mt-10" aria-labelledby="who">
          <h2 id="who" className="text-2xl font-semibold">Who it is for</h2>
          <p className="mt-3 text-zinc-700">Companies with a fleet of cars, trucks, vans or other vehicles and a handful of workshops they send them to. Fleet officers raise the jobs, managers approve them, drivers report odometer readings from their phones, and workshops send their estimates through a link.</p>
        </section>

        <section className="mt-12" aria-labelledby="flow">
          <h2 id="flow" className="text-2xl font-semibold">How a repair moves through Fleet OTG</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="flex gap-4 rounded-xl border border-zinc-200 bg-white p-4">
                <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-side text-sm font-semibold text-white">{i + 1}</span>
                <span><span className="block font-semibold">{t}</span><span className="mt-1 block text-sm text-zinc-600">{d}</span></span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12" aria-labelledby="solves">
          <h2 id="solves" className="text-2xl font-semibold">Problems it solves</h2>
          <div className="mt-6 space-y-6">
            {SOLVES.map((s) => (
              <div key={s.problem}>
                <h3 className="text-lg font-semibold">{s.problem}</h3>
                <p className="mt-1 text-zinc-700">{s.answer}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-12 rounded-xl border border-zinc-200 bg-white p-6" aria-labelledby="next">
          <h2 id="next" className="text-xl font-semibold">See whether it fits your fleet</h2>
          <p className="mt-2 text-zinc-700">Every company gets its own workspace, kept apart from every other company&apos;s. Try everything during the free trial.</p>
          <div className="mt-5 flex flex-wrap items-center gap-4">
            <a href="/signup" className="rounded-md bg-brand px-6 py-3 font-semibold text-white hover:opacity-90">Start your free trial</a>
            <a href="/pricing" className="font-medium text-brand underline">See pricing</a>
            <a href="/about" className="font-medium text-brand underline">About us</a>
            <a href="/contact" className="font-medium text-brand underline">Contact us</a>
          </div>
        </section>
      </article>
    </SiteShell>
  );
}
