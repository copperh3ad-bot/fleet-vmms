import { pageMeta } from "@/lib/site";
import { SiteShell } from "@/components/site-shell";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, webPageLd } from "@/lib/seo";
import { Icon } from "@/components/icons";
import { PageHero, CtaBand } from "@/components/page-hero";

const TITLE = "Fleet maintenance software features · Fleet OTG";
const DESCRIPTION = "How Fleet OTG handles fleet maintenance: job cards with recorded approvals, workshop quotations checked against invoices, servicing, budgets and vehicle papers.";
export const metadata = pageMeta(TITLE, DESCRIPTION);

// Static text (ADR-031). Each block is a problem a company with a fleet meets, and the thing in the product that answers it today.
// Nothing here is a statistic, a customer claim or a price.
const ICONS = ["approve", "papers", "workshop", "phone", "budget", "odometer", "service", "shield", "workshop", "odometer"];
const SOLVES: { problem: string; answer: string }[] = [
  { problem: "Nobody can say who approved a repair", answer: "Job cards, quotations and invoices are approved with the person's name and the time. Whoever raises a request cannot approve it, and every step is recorded." },
  { problem: "Repair history is scattered across spreadsheets and chats", answer: "Each repair is one job card with a clear status and a full history of who did what and when. Drivers and fleet officers raise jobs, and managers approve them." },
  { problem: "Workshop quotations and invoices do not match", answer: "A workshop sends its estimate through a one-time link on its own phone number, recorded against the job card number. The invoice is checked against the approved quotation before payment, and not by the person who approved the job." },
  { problem: "Drivers need an account just to report a reading", answer: "Drivers send their monthly odometer reading from a phone link. There is no app and no password, and the link works once." },
  { problem: "Nobody knows what each vehicle costs", answer: "Spend is counted per vehicle and per period against its budget, and follows whoever held the vehicle at the time." },
  { problem: "The same fault keeps coming back", answer: "Every job records a reason, and a repeat repair on the same vehicle is flagged, so you can see what keeps failing and why." },
  { problem: "Servicing and papers are missed", answer: "Set the servicing rules once and see what is overdue, coming up, or has no history at all. Insurance, fitness, token tax, accidents and fines are kept in one place with reminders before they expire." },
  { problem: "Employees borrow each other's logins", answer: "Every sign-in is tied to an employee code and a role, so each action traces to a real person. Drivers who only report readings need no account." },
  { problem: "One department runs its own vehicles", answer: "Mark vehicles as belonging to a department such as Logistics or Operations. A person in that department raises, approves and follows jobs on its own vehicles only, with a spending limit above which a fleet manager decides, while the rest of the fleet and the company's money stay out of sight." },
  { problem: "Loaders and forklifts are serviced by hours, not kilometres", answer: "Switch on an hour meter for a vehicle and enter readings or add them to a job card. Service rules can be in hours, kilometres, months or any mix, and cost per engine hour appears beside cost per kilometre in the reports." },
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
      <PageHero eyebrow="Features" title="Fleet maintenance management software, built around the job card">
        <p>Fleet OTG is fleet maintenance management software for companies that run their own vehicles. Every repair becomes one job card with a recorded approval trail, so you can see what each vehicle costs, who approved the work, and what is coming due.</p>
      </PageHero>
      <article className="mx-auto max-w-6xl 2xl:max-w-[96rem] px-5 py-12">
        <section aria-labelledby="who" className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-[var(--shadow-card)]">
          <h2 id="who" className="text-2xl font-semibold">Who it is for</h2>
          <p className="mt-3 max-w-3xl text-zinc-700">Companies with a fleet of cars, trucks, vans or other vehicles and a handful of workshops they send them to. Fleet officers raise the jobs, managers approve them, drivers report odometer readings from their phones, and workshops send their estimates through a link.</p>
        </section>

        <section className="mt-14" aria-labelledby="flow">
          <h2 id="flow" className="text-2xl font-semibold">How a repair moves through Fleet OTG</h2>
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="reveal flex gap-4 rounded-xl border border-zinc-200 bg-white p-5">
                <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-side text-sm font-semibold text-white">{i + 1}</span>
                <span><span className="block font-semibold">{t}</span><span className="mt-1 block text-sm text-zinc-600">{d}</span></span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-14" aria-labelledby="solves">
          <h2 id="solves" className="text-2xl font-semibold">Problems it solves</h2>
          <div className="mt-6 grid gap-5 md:grid-cols-2">
            {SOLVES.map((s, i) => (
              <div key={s.problem} className="reveal lift group rounded-2xl border border-zinc-200 bg-white p-6 shadow-[var(--shadow-card)]">
                <span aria-hidden className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-side text-badge transition-colors group-hover:bg-brand group-hover:text-white"><Icon name={ICONS[i]} /></span>
                <h3 className="text-lg font-semibold">{s.problem}</h3>
                <p className="mt-2 text-sm text-zinc-700">{s.answer}</p>
              </div>
            ))}
          </div>
        </section>

        <p className="mt-10 max-w-3xl text-zinc-700">Every company gets its own workspace, kept apart from every other company&apos;s. Try everything during the free trial.</p>
      </article>
      <CtaBand title="See whether it fits your fleet">
        <a href="/signup" className="shine inline-flex items-center gap-2 rounded-md bg-badge px-6 py-3 font-semibold text-side hover:opacity-90">Start your free trial <Icon name="arrow" /></a>
        <a href="/pricing" className="font-medium text-white underline">See pricing</a>
        <a href="/about" className="font-medium text-white underline">About us</a>
        <a href="/contact" className="font-medium text-white underline">Contact us</a>
      </CtaBand>
    </SiteShell>
  );
}
