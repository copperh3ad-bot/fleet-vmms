// The key selling points shown on the landing and Features pages. One list so the two cannot drift. Every line names something the
// product does today: no statistics, no customer claims and no prices (the price lives in the plans table, CLAUDE.md rule 7).
export type Point = { icon: string; art: string; title: string; text: string };

export const SELLING_POINTS: Point[] = [
  { icon: "shield", art: "approve", title: "Nobody approves their own job", text: "Every approval carries a name and a time. The person who raises a request cannot approve it." },
  { icon: "workshop", art: "quote", title: "Pay only what was approved", text: "The workshop's invoice is checked against the approved quotation, by someone other than the approver." },
  { icon: "phone", art: "phone", title: "No app for drivers or workshops", text: "A one-time link on any phone is enough. Your team joins with a WhatsApp code." },
  { icon: "bell", art: "bell", title: "Reminders before things lapse", text: "Licences, papers and service due dates reach the right people in the app and by email." },
  { icon: "budget", art: "budget", title: "Cost on the right vehicle", text: "Spend is counted per vehicle, department and period, and follows whoever held the vehicle." },
  { icon: "users", art: "shield", title: "One price, no per-user charges", text: "Your whole company, any number of users. Your data stays yours and can be exported at any time." },
];
