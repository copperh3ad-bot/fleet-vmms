// What each plan includes, for the public comparison page (ADR-063). Plain text with no price: the price lives in the plans table (CLAUDE.md rule 7) and the page
// reads it from there. Every row is something the product does today. Basic has every feature that is not the AI; Pro is Basic plus the AI rows (ADR-035).
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
    title: "AI and WhatsApp",
    rows: [
      proOnly("AI reads a workshop's emailed estimate or invoice", "It fills in the form; a person always checks and saves."),
      proOnly("Raise a job card by sending one WhatsApp message", "The AI makes a draft, the employee confirms, and a manager approves it in the app."),
    ],
  },
];

/** Rows that Basic does not include: used by the page's summary line and by the test that keeps Basic complete. */
export const proOnlyRows = () => COMPARE.flatMap((g) => g.rows).filter((r) => !r.basic);
