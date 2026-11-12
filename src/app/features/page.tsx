import { pageMeta } from "@/lib/site";
import { SiteShell } from "@/components/site-shell";
import { JsonLd } from "@/components/json-ld";
import { breadcrumbLd, webPageLd } from "@/lib/seo";
import { Icon } from "@/components/icons";
import { PageHero, CtaBand } from "@/components/page-hero";
import { SELLING_POINTS } from "@/lib/selling-points";
import { Art } from "@/components/art";

const TITLE = "Fleet maintenance and operations software features · Fleet OTG";
const DESCRIPTION = "How Fleet OTG handles fleet maintenance: job cards with recorded approvals, workshop quotations checked against invoices, reminders, servicing, budgets, vehicle requests and papers. Pro makes it a fleet operations solution with trip scheduling, cargo requests, logistics provider quotes, the AI and a WhatsApp menu.";
export const metadata = pageMeta(TITLE, DESCRIPTION);

// Static text (ADR-031). Each block is a problem a company with a fleet meets, and the thing in the product that answers it today.
// Nothing here is a statistic, a customer claim or a price.
const ART = ["approve", "sheets", "quote", "phone", "budget", "repeat", "papers", "shield", "departments", "bell", "request", "policy", "workshop", "service", "repeat", "sheets", "shield", "budget", "service"];
const STEP_ICONS = ["papers", "approve", "workshop", "budget", "shield", "export"];
const SOLVES: { problem: string; answer: string; pro?: boolean }[] = [
  { problem: "Nobody can say who approved a repair", answer: "Job cards, quotations and invoices are approved with the person's name and the time. Whoever raises a request cannot approve it, and every step is recorded." },
  { problem: "Repair history is scattered across spreadsheets and chats", answer: "Each repair is one job card with a clear status and a full history of who did what and when. Drivers and fleet officers raise jobs, and managers approve them." },
  { problem: "Workshop quotations and invoices do not match", answer: "A workshop sends its estimate through a one-time link on its own phone number, recorded against the job card number. The invoice is checked against the approved quotation before payment, and not by the person who approved the job." },
  { problem: "Drivers need an account just to report a reading", answer: "Drivers send their monthly odometer reading from a phone link. There is no app and no password, and the link works once." },
  { problem: "Nobody knows what each vehicle costs", answer: "Spend is counted per vehicle and per period against its budget, and follows whoever held the vehicle at the time." },
  { problem: "The same fault keeps coming back", answer: "Every job records a reason, and a repeat repair on the same vehicle is flagged, so you can see what keeps failing and why." },
  { problem: "Servicing and papers are missed", answer: "Set the servicing rules once and see what is overdue, coming up, or has no history at all. Insurance, fitness, token tax, accidents and fines are kept in one place with reminders before they expire." },
  { problem: "Employees borrow each other's logins", answer: "Every sign-in is tied to an employee code and a role, so each action traces to a real person. Drivers who only report readings need no account." },
  { problem: "One department runs its own vehicles", answer: "Mark vehicles as belonging to a department such as Logistics or Operations. A person in that department raises, approves and follows jobs on its own vehicles only, with a spending limit above which a fleet manager decides, while the rest of the fleet and the company's money stay out of sight." },
  { problem: "Licences and service dates slip past unnoticed", answer: "Every day the system looks for licences, insurance, fitness and token tax that are running out and for periodic maintenance that is due. The vehicle holder and the fleet managers see it in the app and get one email, so the reminder reaches a person and not an inbox nobody reads." },
  { problem: "Nobody knows who may take a vehicle", answer: "HR requests a vehicle for an employee, a fleet manager decides, and the decision is recorded. An employee has one open request at a time, and nobody decides their own." },
  { problem: "The maintenance policy sits in a drawer", answer: "Upload the policy and keep every version. The app applies it: when a vehicle is due for replacement, which accidents the company covers, and the driver's share of a repair. A reader finds the rules in your file, and a person reviews them before anything is saved." },
  { problem: "Nobody can say which workshop is best", answer: "Every workshop has a scorecard: the days it takes, its quotation against the final bill, and how often its work comes back. Keep your agreed rate card for each workshop." },
  { problem: "Vehicles sit in the workshop and nobody counts the days", answer: "See the time each vehicle spent in the workshop and the fleet's availability, beside cost per kilometre, per engine hour and per driver, for any period you choose." },
  { problem: "Nobody knows why the same jobs keep happening", answer: "The Why it keeps breaking report groups jobs by reason and by driver, vehicle or workshop, and checks the quality of the reasons people recorded." },
  { problem: "Photos and papers are scattered across phones", answer: "Attach photos and files to job cards, accidents and vehicles, including the registration book scan. Accidents, fines (challans), route permits and driving licences each have a record, with reminders before papers expire." },
  { problem: "Some people see too much, and others too little", answer: "Roles for the administrator, fleet manager, finance, HR and a read-only auditor, with a table of what each can do. A driver or requester limited to one vehicle sees only that vehicle's dashboard and job cards." },
  { problem: "Reports live in one person's spreadsheet", answer: "A dashboard is built for each role: approvals waiting, service due, a year of spend, the costliest vehicles. Budgets warn early and plan next year, and every list and report exports to CSV, even when a workspace is locked." },
  { problem: "Loaders and forklifts are serviced by hours, not kilometres", answer: "Switch on an hour meter for a vehicle and enter readings or add them to a job card. Service rules can be in hours, kilometres, months or any mix, and cost per engine hour appears beside cost per kilometre in the reports." },
];

const PRO: { problem: string; answer: string; art: string; pro?: boolean }[] = [
  { problem: "Maintenance rules take hours to write down", answer: "The AI reads the maintenance policy you upload and drafts the rules from it. A person checks and saves them, and it stays off until your administrator switches it on.", art: "ai", pro: true },
  { problem: "Pool cars and staff transport run on phone calls", answer: "Request, approve and schedule a trip, with a vehicle and a driver, clashes shown, and the odometer recorded out and back, so mileage and the person who had the vehicle are on record.", art: "trip", pro: true },
  { problem: "Cargo pick-ups and deliveries are arranged by phone", answer: "Staff ask for a cargo pick-up or delivery with the place, the time, what it is and how heavy. The fleet manager accepts it, schedules it, follows it to delivery and can turn it into a trip, and every step is on record.", art: "cargo", pro: true },
  { problem: "Typing in every workshop estimate and invoice", answer: "When a workshop emails an estimate or invoice, the AI reads the attached file and fills in the form as a draft. A person always checks the figures and saves, so every approval still carries a real name and time.", art: "ai", pro: true },
  { problem: "Staff will not open an app to report a fault", answer: "An employee sends one WhatsApp message describing the fault. The AI drafts the job card, asks for anything missing, and the employee confirms. It goes in as a request, and a manager approves it in the app as usual.", art: "chat", pro: true },
];

PRO.push(
  { problem: "Staff need a simple way to ask for things", answer: "An employee says Hi on WhatsApp and picks from a list: submit a job card, ask for a cargo pick-up or delivery, reserve a trip, or send an odometer reading. Each one asks a few short questions, so the fleet manager gets complete information. Coming soon: cargo, trip and job card requests as one short form with dropdowns and a date picker, in a single message. A job card is one of ten kinds of work (periodic maintenance, brakes, suspension, battery, body work, lights, tyres, wheel balancing and alignment, AC, or others explained in up to 100 words).", art: "menu", pro: true },
  { problem: "Moving goods or people needs a third-party truck", answer: "Send one trip to several logistics providers. Each quotes through a link on its own phone, and you compare the quotes beside your own rate cards. Whoever may award picks one and the award is recorded; the provider then invoices through a link and finance checks it against the amount awarded.", art: "tender", pro: true },
  { problem: "Several quotes and no easy way to weigh them", answer: "The AI ranks the quotes by price against your rate cards, the provider's record with you, and the vehicle and start time offered, and explains why. It only advises. A person awards, and the provider's name is never sent to the AI.", art: "ai", pro: true },
);

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
      <PageHero eyebrow="Features" title="Fleet maintenance software that stops you paying for repairs nobody checked" chips={["Approvals on record", "Quote vs invoice", "Reminders by email", "Trips and cargo on Pro", "Per-vehicle cost"]} art={<Art name="fleet" />}>
        <p>Fleet OTG is fleet maintenance and operations software for companies that run their own vehicles, and it starts with maintenance. Every repair becomes one job card with a recorded approval trail, so you can see what each vehicle costs, who approved the work, and what is coming due. Basic is maintenance management. Pro adds fleet operations (trip scheduling, cargo requests and logistics providers), the AI and WhatsApp, which makes it a fleet operations solution.</p>
      </PageHero>
      <article className="mx-auto max-w-6xl 2xl:max-w-[96rem] px-5 py-12">
        <section aria-labelledby="why" className="mb-14">
          <h2 id="why" className="text-2xl font-semibold">Why fleet owners switch</h2>
          <ul className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {SELLING_POINTS.map((p) => (
              <li key={p.title} className="group rounded-2xl border border-zinc-200 bg-white p-4 shadow-[var(--shadow-card)]">
                <Art name={p.art} className="!shadow-none" />
                <p className="mt-4 px-1 font-semibold">{p.title}</p><p className="mt-1 px-1 pb-1 text-sm text-zinc-600">{p.text}</p>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="who" className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-[var(--shadow-card)]">
          <h2 id="who" className="text-2xl font-semibold">Who it is for</h2>
          <p className="mt-3 max-w-3xl text-zinc-700">Companies with a fleet of cars, trucks, vans or other vehicles and a handful of workshops they send them to. Fleet officers raise the jobs, managers approve them, drivers report odometer readings from their phones, and workshops send their estimates through a link.</p>
        </section>

        <section className="mt-14" aria-labelledby="flow">
          <h2 id="flow" className="text-2xl font-semibold">How a repair moves through Fleet OTG</h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
            {STEPS.map(([t, d], i) => (
              <li key={t} className="reveal relative rounded-2xl bg-side p-5 text-white">
                <span aria-hidden className="absolute -top-3 left-4 flex h-7 w-7 items-center justify-center rounded-full bg-badge text-sm font-bold text-side">{i + 1}</span>
                <span aria-hidden className="mt-2 flex h-12 w-12 items-center justify-center rounded-xl bg-white/10 text-badge"><Icon name={STEP_ICONS[i]} size={26} /></span>
                <span className="mt-3 block font-semibold">{t}</span><span className="mt-1 block text-sm text-[#B6C6D0]">{d}</span>
                {i < STEPS.length - 1 && <span aria-hidden className="absolute -right-3 top-1/2 z-10 hidden h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-badge text-side lg:flex"><Icon name="arrow" size={14} /></span>}
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-14" aria-labelledby="solves">
          <h2 id="solves" className="text-2xl font-semibold">The problems that cost you money, and how Fleet OTG ends them</h2>
          <div className="mt-8 space-y-10">
            {SOLVES.map((s, i) => (
              <div key={s.problem} className="reveal grid items-center gap-6 md:grid-cols-2 md:gap-10">
                <Art name={ART[i]} className={i % 2 ? "md:order-2" : ""} />
                <div>
                  <h3 className="text-xl font-semibold">{s.problem}</h3>
                  <p className="mt-2 text-zinc-700">{s.answer}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14" aria-labelledby="pro-h">
          <div className="rounded-2xl border-2 border-brand bg-white p-6 shadow-[var(--shadow-card)] md:p-8">
            <p className="inline-block rounded-full bg-badge px-3 py-1 text-xs font-semibold text-side">Pro</p>
            <h2 id="pro-h" className="mt-3 text-2xl font-semibold">Pro: fleet operations, with AI and WhatsApp</h2>
            <p className="mt-2 max-w-3xl text-zinc-700">For busy fleets that move vehicles, people and cargo as well as repair them. Pro is Basic plus these, and any Basic company can try it free for 7 days. The AI only drafts and advises; a person always checks, saves and decides.</p>
            <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {PRO.map((s) => (
                <div key={s.problem} className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                  <Art name={s.art} className="!shadow-none" />
                  <h3 className="mt-4 text-lg font-semibold">{s.problem}</h3>
                  <p className="mt-2 text-sm text-zinc-700">{s.answer}</p>
                </div>
              ))}
            </div>
            <p className="mt-6"><a href="/compare" className="font-medium text-brand underline">Compare Basic and Pro side by side</a></p>
          </div>
        </section>

        <p className="mt-10 max-w-3xl text-zinc-700">Every company gets its own workspace, kept apart from every other company&apos;s. Try everything during the free trial.</p>
      </article>
      <CtaBand title="Stop guessing what your fleet costs. Start knowing.">
        <a href="/signup" className="shine inline-flex items-center gap-2 rounded-md bg-badge px-6 py-3 font-semibold text-side hover:opacity-90">Start your free trial <Icon name="arrow" /></a>
        <a href="/pricing" className="font-medium text-white underline">See pricing</a>
        <a href="/about" className="font-medium text-white underline">About us</a>
        <a href="/contact" className="font-medium text-white underline">Contact us</a>
      </CtaBand>
    </SiteShell>
  );
}
