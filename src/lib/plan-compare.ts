// What each plan includes, for the public comparison page (ADR-063). Plain text with no price: the price lives in the plans table (CLAUDE.md rule 7) and the page
// reads it from there. Every row is something the product does today. Basic has every feature that is not the AI, the WhatsApp menu or the logistics provider quotes; Pro is Basic plus those rows (ADR-035, ADR-078, ADR-079, ADR-080).
export type CompareRow = { feature: string; detail?: string; basic: boolean; pro: boolean };
export type CompareGroup = { title: string; rows: CompareRow[] };

const both = (feature: string, detail?: string): CompareRow => ({ feature, detail, basic: true, pro: true });
const proOnly = (feature: string, detail?: string): CompareRow => ({ feature, detail, basic: false, pro: true });

export const COMPARE: CompareGroup[] = [
  {
    title: "Job cards and approvals",
    rows: [
      both("Job cards with every step recorded", "Who did what and when, from the request to the closed job."),
      both("Approvals with the person's name and the time", "Whoever raises a request cannot approve it."),
      both("Repeat repairs flagged", "A fault coming back on the same vehicle is shown, with the reason recorded for every job."),
      both("Vehicle requests from HR", "HR asks for a vehicle for an employee; a manager gives one from the pool or approves buying one."),
    ],
  },
  {
    title: "Workshops",
    rows: [
      both("Workshops never sign up", "A one-time link on the workshop's phone, or an email reply, filed on the job card."),
      both("Quotations approved before work starts"),
      both("Invoices checked against the approved quotation", "And not by whoever approved the job."),
    ],
  },
  {
    title: "Vehicles, people and servicing",
    rows: [
      both("Vehicle records and who held each vehicle", "Cost follows whoever had it at the time."),
      both("Servicing rules with due and overdue", "By months, kilometres or engine hours, with a reminder when a service is due."),
      both("Reminders for papers and driving licences", "Insurance, fitness, token tax and licence expiry, with reminders before they run out."),
      both("Odometer and engine hours from a phone link", "Drivers need no account and no app."),
      both("Departments with their own vehicles", "With a spending limit above which a manager decides."),
      both("Trip requests (optional module)", "Request, approve and record a trip, with the odometer out and back."),
      both("Cargo requests: pick-up and delivery", "Staff ask for a cargo pick-up or delivery; the fleet manager accepts it, schedules it and follows it to delivery, and can turn it into a trip."),
    ],
  },
  {
    title: "Costs and reports",
    rows: [
      both("Budgets per vehicle and per period"),
      both("Cost per vehicle, per kilometre and per department"),
      both("Reports and exports of your own data"),
      both("Import your vehicles from Excel"),
    ],
  },
  {
    title: "Accounts and security",
    rows: [
      both("Every sign-in tied to an employee code and a role", "So each action traces to a person."),
      both("Your company's data kept apart from every other company's"),
      both("No per-user charges", "The whole company is covered by one plan."),
    ],
  },
  {
    title: "AI, WhatsApp and logistics providers",
    rows: [
      proOnly("AI reads a workshop's emailed estimate or invoice", "It fills in the form; a person always checks and saves."),
      proOnly("Raise a job card by sending one WhatsApp message", "The AI makes a draft, the employee confirms, and a manager approves it in the app."),
      proOnly("WhatsApp menu with a short questionnaire for each task", "An employee says Hi and chooses: submit a job card (ten kinds of work, explained in up to 100 words only for Others), ask for a cargo pick-up or delivery, reserve a trip, or send an odometer reading. Complete answers reach the fleet manager, who approves in the app."),
      proOnly("Quotes from several logistics providers for one trip", "Send a trip to the providers you choose. Each quotes through a link on its own phone, you compare the quotes beside your own rate cards, and one is awarded with the award recorded."),
      proOnly("AI compares the logistics provider quotes", "It ranks the quotes by price against your rate cards, the provider's record with you, and the vehicle offered, and says why. It only advises: a person awards."),
      proOnly("Logistics provider invoices checked before payment", "The provider invoices through a link; finance checks it against the amount awarded, and not the person who awarded the trip."),
    ],
  },
];

/** Rows that Basic does not include: used by the page's summary line and by the test that keeps Basic complete. */
export const proOnlyRows = () => COMPARE.flatMap((g) => g.rows).filter((r) => !r.basic);
