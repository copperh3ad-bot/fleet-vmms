// Tax on a subscription for a Pakistani customer (ADR-017). Pure arithmetic, no database, no rates of its own: every rate comes
// from settings the owner (with an accountant) enters, so a change in the law is a settings change, not a code change.
//
// The price is in USD (rule 7) and tax goes on top. Tax is worked out in rupees, on the rupee value of the price at the rate
// fixed on the day the invoice is made:
//   subtotal        = price in USD x rupees per dollar
//   sales tax       = subtotal x the sales tax rate of the authority the customer falls under
//   total           = subtotal + sales tax                        (what the invoice asks for)
// A customer that is a withholding agent keeps back part of the tax and pays that to the government in our name, giving us a
// certificate. We then receive less than the total, and the certificate is how we claim the credit:
//   income tax withheld = a percent of the subtotal (or of the total, if that is how the accountant says it applies)
//   sales tax withheld  = a share of the sales tax
//   net expected        = total - income tax withheld - sales tax withheld
// All amounts are whole paisa (1/100 rupee), rounded half up, so every figure on an invoice adds up exactly.

export type TaxInput = {
  /** The subscription price for the months being paid, in cents of a dollar. */
  subtotalUsdCents: number;
  /** Rupees for one dollar, as set by the owner on the day. */
  pkrPerUsd: number;
  /** Percent, for example 16. 0 or missing: no sales tax is charged. */
  salesTaxPct: number;
  /** The customer holds back tax when it pays. */
  withholdingAgent: boolean;
  /** Percent of the base kept back as income tax. */
  whtIncomePct: number;
  /** Percent of the sales tax kept back by the customer (some withholding agents keep back all of it, some part, some none). */
  whtSalesSharePct: number;
  /** Income tax is taken on the subtotal (before sales tax) or on the total (with it). */
  whtIncomeBase: "subtotal" | "total";
};

export type TaxResult = {
  pkrPerUsd: number;
  subtotalMinor: number;
  salesTaxPct: number;
  salesTaxMinor: number;
  totalMinor: number;
  whtIncomeMinor: number;
  whtSalesMinor: number;
  /** What should reach our bank if the customer pays correctly. */
  netExpectedMinor: number;
};

const pct = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);
/** Half up, on whole paisa. A millionth of a paisa is rounded away first, so floating-point noise (100.49999999999999) cannot tip a .5 the wrong way. */
export const roundHalfUp = (x: number): number => Math.floor(Math.round(x * 1e6) / 1e6 + 0.5);

export function computeTax(i: TaxInput): TaxResult {
  if (!(i.pkrPerUsd > 0)) throw new Error("computeTax needs the rupees-per-dollar rate");
  if (!Number.isInteger(i.subtotalUsdCents) || i.subtotalUsdCents < 0) throw new Error("computeTax needs whole cents");
  const subtotalMinor = roundHalfUp(i.subtotalUsdCents * i.pkrPerUsd);                 // cents x rupees per dollar = paisa
  const salesTaxPct = pct(i.salesTaxPct);
  const salesTaxMinor = roundHalfUp((subtotalMinor * salesTaxPct) / 100);
  const totalMinor = subtotalMinor + salesTaxMinor;
  let whtIncomeMinor = 0, whtSalesMinor = 0;
  if (i.withholdingAgent) {
    whtIncomeMinor = roundHalfUp(((i.whtIncomeBase === "total" ? totalMinor : subtotalMinor) * pct(i.whtIncomePct)) / 100);
    whtSalesMinor = roundHalfUp((salesTaxMinor * Math.min(pct(i.whtSalesSharePct), 100)) / 100);
  }
  return { pkrPerUsd: i.pkrPerUsd, subtotalMinor, salesTaxPct, salesTaxMinor, totalMinor, whtIncomeMinor, whtSalesMinor, netExpectedMinor: totalMinor - whtIncomeMinor - whtSalesMinor };
}

/** "Rs 41,720.00" from paisa. */
export const rupees = (minor: number | string): string =>
  `Rs ${(Number(minor) / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** How far what arrived is from what should have: positive means more than expected. Within one rupee counts as exact (bank fees, rounding). */
export function shortfall(receivedMinor: number, netExpectedMinor: number): { state: "exact" | "short" | "over"; diffMinor: number } {
  const diff = receivedMinor - netExpectedMinor;
  return { state: Math.abs(diff) <= 100 ? "exact" : diff < 0 ? "short" : "over", diffMinor: diff };
}
