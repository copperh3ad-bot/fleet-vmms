// The questions people ask before they sign up, in plain words. One list feeds the visible FAQ on the page and the FAQPage
// structured data beside it, so a search or answer engine reads exactly what a person reads. Every answer names something the
// product does today: no statistics, no customer claims, no prices (the price lives in the plans table, ADR-014).
export type Faq = { q: string; a: string };

export const HOME_FAQ: Faq[] = [
  { q: "What is Fleet OTG?", a: "Fleet OTG is fleet maintenance management software for companies that run vehicles. Every repair is one job card with an approval trail, workshop quotations are compared with invoices before payment, and servicing, budgets, papers and fines are kept in one place per company." },
  { q: "Who is Fleet OTG for?", a: "Companies that run their own vehicles and want to know what each one costs: fleet officers who raise jobs, managers who approve them, drivers who report odometer readings, and the workshops that repair the vehicles." },
  { q: "Is my data separate from other companies?", a: "Yes. Every company's records are kept apart from every other company's. People from other companies cannot see them, and we check this with automated tests." },
  { q: "Can workshops send their quotation through Fleet OTG?", a: "Yes. A workshop gets a one-time link on its own phone number, opens it without an account, and sends its estimate. The estimate is recorded against the job card number, so it sits with the job it is for." },
  { q: "Do my drivers need accounts?", a: "No. Drivers who only send odometer readings use a link from a message. Staff who approve, raise or review jobs sign in." },
  { q: "Can a job card be filled in without internet?", a: "Yes. The job card form is also available as an Excel file that can be filled in at the workshop with no internet and uploaded afterwards." },
  { q: "How does Fleet OTG stop one person approving their own request?", a: "Approval is a step in the job card, recorded with the person's name and the time. Whoever raises a request cannot approve it, and an invoice cannot be checked by the person who approved the job." },
  { q: "Which currency does it use?", a: "Each company's workspace shows amounts in the currency that company chose when it signed up." },
  { q: "Does Fleet OTG use AI?", a: "Only where your administrator switches it on, and only to save typing: when a workshop emails an estimate or invoice, the AI can read the attached file and fill in the form as a draft. A person always checks the figures and saves, so every approval still carries a real person's name and time. It is off until you switch it on, and your records are never used to train AI." },
  { q: "Can I export my data?", a: "Yes. Costs by vehicle and job cards can be exported, and you can still sign in to export everything if a workspace is locked." },
  { q: "What happens after the trial?", a: "The workspace locks until you subscribe. Nothing is deleted, and you can still export your data. We keep it for 30 days after a lock." },
  { q: "How do I pay?", a: "By direct bank transfer for now. You send the transfer, upload the receipt, and we confirm it. Card payment is planned." },
];

export const PRICING_FAQ: Faq[] = [
  { q: "What is the difference between Basic and Pro?", a: "Basic has every feature of Fleet OTG and is where every company starts. Pro, coming in a second phase as an upgrade for companies that enter a lot of job cards every day, is Basic plus AI that reads the estimates and invoices your workshops email and fills in the form for your staff to check. A person always checks and saves, the AI is off until your administrator switches it on, and your records are never used to train AI." },
  { q: "What if we do not subscribe?", a: "After a short grace period the workspace locks. Nothing is deleted, and you can still sign in to export all your data." },
  { q: "Do you take cards?", a: "Not yet. Bank transfer works today; card payment will be added later." },
  { q: "Can my team join, and what about my workshops?", a: "Your team can join at no extra cost: your administrator gives them a company code, or sends an invitation link by WhatsApp or text message, and approves who gets in. Workshops never sign up: you add each one yourself, and it sends its estimates and invoices through a link or by replying to an email." },
];
