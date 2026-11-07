/** Yearly offer (ADR-057): a customer who pays for 12 months gets one of them free, so 12 months of access cost 11 months' price.
 *  The owner decides the offer; the monthly price itself stays in the `plans` table (CLAUDE.md rule 7). */
export const FREE_MONTHS_PER_YEAR = 1;

/** How many months' price is charged for this many months of access. */
export function billedMonths(months: number): number {
  return months >= 12 ? months - FREE_MONTHS_PER_YEAR * Math.floor(months / 12) : months;
}
