// A plain-text summary of the site for AI assistants and answer engines (llmstxt.org, ADR-031). Static: it names only the public
// pages and says what the product is, nothing about any customer, and no price (the price lives in the plans table, ADR-014).
import { INDEXABLE_PATHS, SITE_URL } from "@/lib/site";
import { SITE_SUMMARY } from "@/lib/seo";

const PAGES: Record<string, [string, string]> = {
  "/": ["Home", "What Fleet OTG is, what you get, and common questions."],
  "/features": ["Features", "How a repair moves through Fleet OTG, and the fleet problems it solves."],
  "/pricing": ["Pricing", "The plan, how the free trial works, and how paying works."],
  "/compare": ["Compare plans", "What Basic and Pro include, side by side."],
  "/about": ["About us", "Why Fleet OTG exists and how the team works."],
  "/contact": ["Contact us", "Ask a question before signing up, or get help with an account or a payment."],
  "/signup": ["Start a free trial", "Create a company workspace."],
  "/join": ["Join your company", "For staff joining a company that already uses Fleet OTG, with a company code."],
  "/terms": ["Terms", "Terms of use."],
  "/privacy": ["Privacy", "How personal information is handled."],
};

export function GET() {
  const links = INDEXABLE_PATHS.filter((p) => PAGES[p]).map((p) => `- [${PAGES[p][0]}](${SITE_URL}${p === "/" ? "" : p}): ${PAGES[p][1]}`);
  const body = [
    "# Fleet OTG",
    "",
    `> ${SITE_SUMMARY}`,
    "",
    "Fleet OTG is a web application for companies that run their own vehicles. Each company has its own workspace, kept apart from every other company's. Every repair is one job card with a recorded approval trail. Drivers report odometer readings, and workshops and logistics providers send their estimates, quotes and invoices, through one-time links on their phone numbers, with no app to install.",
    "",
    "## What it does",
    "- Job cards with approvals: whoever raises a request cannot approve it, and every step is recorded with the person and the time.",
    "- Workshops and quotations: a workshop's estimate is recorded against the job card number and checked against its invoice before payment.",
    "- Departments and hour meters: vehicles can belong to an operating department that looks after its own jobs, and loaders or forklifts can be serviced by engine hours as well as kilometres and months.",
    "- Reminders: every day, licences, insurance, fitness and token tax that are running out and periodic maintenance that is due are shown in the app and emailed to the vehicle holder and the fleet managers.",
    "- Vehicle requests and trips: HR requests a vehicle for an employee and a manager decides; an optional trips module records the odometer out and back.",
    "- Cargo requests: staff ask for a cargo pick-up or delivery; the fleet manager accepts, schedules and follows it, or turns it into a trip.",
    "- Pro plan: AI that reads workshop estimates and invoices into a draft; job cards raised from one WhatsApp message; a WhatsApp menu (job card, cargo, trip, odometer) with a short questionnaire each (one short form with dropdowns for cargo, trip and job card requests is coming soon); and trips sent to several logistics providers for quotes, with the AI advising on which to award. A person always checks, saves and decides. See the Compare plans page.",
    "- Servicing, budgets and papers: what is due or overdue, spend per vehicle against its budget, and insurance, fitness, token tax, accident and fine records with expiry reminders.",
    "",
    "## Pages",
    ...links,
    "",
    "## Notes",
    "- The current price is on the pricing page.",
    "- Pages under /w/, /admin, /o/, /q/ and /invite/ are private and need a sign-in or a one-time link.",
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
