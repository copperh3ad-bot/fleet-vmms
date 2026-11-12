// The key selling points shown on the landing and Features pages. One list so the two cannot drift. Every line names something the
// product does today: no statistics, no customer claims and no prices (the price lives in the plans table, CLAUDE.md rule 7).
// Written as the owner's pain and the product's answer, in the buyer's words.
export type Point = { icon: string; art: string; title: string; text: string };

export const SELLING_POINTS: Point[] = [
  { icon: "shield", art: "approve", title: "Stop paying for repairs nobody approved", text: "Every approval carries a name and a time, and whoever raises a request cannot approve it. When money is questioned, you have the answer." },
  { icon: "workshop", art: "quote", title: "Never pay more than the quotation", text: "Each invoice is set against the approved quotation, line by line, and checked by someone other than the approver. Extra lines are caught before you pay." },
  { icon: "phone", art: "phone", title: "Your drivers and workshops start today", text: "No app to install and no password to forget. A one-time link on any phone is enough, and your team joins with a WhatsApp code." },
  { icon: "bell", art: "bell", title: "Never again a vehicle off the road for an expired paper", text: "Licences, insurance, fitness, token tax and service dates reach the right people in the app and by email before they lapse." },
  { icon: "budget", art: "budget", title: "See what every vehicle really costs", text: "Spend is counted per vehicle, department and period, and follows whoever held the vehicle. Budgets warn you early, not after the year ends." },
  { icon: "users", art: "shield", title: "One price for your whole company", text: "No per-user charges, so you never ration who gets access. Your data stays yours and can be exported at any time." },
];
