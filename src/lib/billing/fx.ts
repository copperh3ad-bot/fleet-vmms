// Dollar-to-rupee rates by date (ADR-018). A tax invoice converts the price at the rate for the day the customer paid.
//   - The operator can always enter a day's rate by hand. That is the dependable route.
//   - A daily fetch of the interbank page of forex.pk is available, but OFF until the owner records that forex.pk has given written
//     consent (its terms of use forbid commercial use without it). With no consent on record, nothing is fetched.
//   - A day with no rate uses the latest earlier one, up to MAX_STALE_DAYS; past that the caller falls back to the manual rate.
import type { Driver, Queryable } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";

export type FxSide = "buying" | "selling" | "average";
export type FxRate = { rate: number; date: string; source: string; side: FxSide };
export type FxRow = { rate_date: string; buy: string; sell: string; source: string; note: string | null };

export const MAX_STALE_DAYS = 7;
const SOURCE_URL = "https://www.forex.pk/inter_bank_rates.asp";
const iso = (d: Date) => d.toISOString().slice(0, 10);

export const pickSide = (buy: number, sell: number, side: FxSide): number => (side === "selling" ? sell : side === "average" ? Math.round(((buy + sell) / 2) * 10000) / 10000 : buy);

/** The rate for a day: that day's, or the latest earlier one within a week. Null when there is none. */
export async function rateFor(q: Queryable, onDate: string, side: FxSide = "buying"): Promise<FxRate | null> {
  const r = (await q.query<{ rate_date: string; buy: string; sell: string; source: string }>(
    `select rate_date::text, buy::text, sell::text, source from public.fx_rates where rate_date <= $1::date and rate_date >= $1::date - $2::int order by rate_date desc limit 1`, [onDate, MAX_STALE_DAYS])).rows[0];
  return r ? { rate: pickSide(Number(r.buy), Number(r.sell), side), date: r.rate_date, source: r.source, side } : null;
}

async function asOperator<T>(driver: Driver, operatorId: string | null, fn: (q: Queryable) => Promise<T>): Promise<T> {
  return withPlatform(driver, async (q) => {
    if (operatorId !== null) {
      if ((await q.query("select 1 from public.platform_admins where user_id = $1", [operatorId])).rows.length === 0) throw new UserError("Not allowed.");
      await q.query("select set_config('app.user_id', $1, true)", [operatorId]);
    }
    return fn(q);
  });
}

export function listRates(driver: Driver, operatorId: string, limit = 40): Promise<FxRow[]> {
  return asOperator(driver, operatorId, async (q) => (await q.query<FxRow>("select rate_date::text, buy::text, sell::text, source, note from public.fx_rates order by rate_date desc limit $1", [Math.min(Math.max(limit, 1), 400)])).rows);
}

const money = (v: string, field: string): number => {
  const t = v.trim();
  if (!/^\d{1,5}(\.\d{1,4})?$/.test(t) || Number(t) <= 0) throw new UserError("Enter a rate like 277.25.", { [field]: "Enter a rate like 277.25" });
  return Number(t);
};

/** The operator's own rate for a day. Replaces whatever is there for that day, including an automatic one. */
export async function saveRate(driver: Driver, operatorId: string, v: { date: string; buy: string; sell?: string; note?: string }): Promise<void> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date) || Number.isNaN(Date.parse(`${v.date}T00:00:00Z`))) throw new UserError("Enter the date.", { date: "Enter the date" });
  if (v.date > iso(new Date())) throw new UserError("A rate cannot be for a future date.", { date: "Not in the future" });
  const buy = money(v.buy, "buy"), sell = money(v.sell?.trim() ? v.sell : v.buy, "sell");
  if (sell < buy) throw new UserError("The selling rate cannot be below the buying rate.", { sell: "Not below the buying rate" });
  if (sell / buy > 1.05) throw new UserError("Buying and selling rates are more than 5% apart. Check them.", { sell: "Check this rate" });
  await asOperator(driver, operatorId, (q) => q.query(
    `insert into public.fx_rates(rate_date, buy, sell, source, note, entered_by) values ($1, $2, $3, 'manual', $4, $5)
     on conflict (rate_date) do update set buy = excluded.buy, sell = excluded.sell, source = 'manual', note = excluded.note, entered_by = excluded.entered_by, fetched_at = now()`,
    [v.date, buy, sell, (v.note ?? "").trim().slice(0, 200) || null, operatorId]));
}

// ------------------------------------------------------------------------------------------ the automatic fetch

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** Reads the US Dollar row and the "As on" date from the interbank page. Throws if the page is not what it was. */
export function parseInterbankPage(html: string): { date: string; buy: number; sell: number } {
  const on = html.match(/As on\s+[A-Za-z]{3},\s+([A-Za-z]{3})\s+(\d{1,2})\s+(\d{4})/);
  const mm = on ? MONTHS[on[1].toLowerCase()] : undefined;
  if (!on || !mm) throw new Error("the page has no \"As on\" date");
  const row = html.match(/US Dollar<\/td>\s*<td[^>]*>[\s\S]*?USD[\s\S]*?<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*<\/td>\s*<td[^>]*>\s*([\d.,]+)\s*<\/td>/i);
  if (!row) throw new Error("the page has no US Dollar row");
  const buy = Number(row[1].replace(/,/g, "")), sell = Number(row[2].replace(/,/g, ""));
  if (!(buy > 50 && buy < 2000 && sell >= buy && sell / buy < 1.05)) throw new Error(`rate out of range: ${buy} / ${sell}`);
  return { date: `${on[3]}-${mm}-${on[2].padStart(2, "0")}`, buy, sell };
}

export type FetchHtml = (url: string) => Promise<string>;
const defaultFetch: FetchHtml = async (url) => {
  const res = await fetch(url, { headers: { "user-agent": "FleetVMMS-rates/1.0 (daily rate check)" }, signal: AbortSignal.timeout(15000), redirect: "error" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
};

export const consentOnRecord = async (q: Queryable): Promise<boolean> =>
  ((await q.query<{ value: string }>("select value from public.platform_settings where key = 'fx_forexpk_consent'")).rows[0]?.value ?? "").trim().length >= 3;

/**
 * Fetches today's interbank rate and stores it under its own date, unless the operator already entered that day by hand.
 * Does nothing without consent on record. `operatorId` is null when the scheduled job runs it.
 */
export async function fetchInterbankRate(driver: Driver, operatorId: string | null, fetchHtml: FetchHtml = defaultFetch): Promise<{ date: string; buy: number; sell: number; stored: boolean }> {
  if (!(await asOperator(driver, operatorId, consentOnRecord))) throw new UserError("Automatic rates are off. Record that forex.pk has given written consent in Settings first, or enter the rate by hand.");
  let got: { date: string; buy: number; sell: number };
  try { got = parseInterbankPage(await fetchHtml(SOURCE_URL)); }
  catch (e) { throw new UserError(`The rate could not be read from forex.pk (${e instanceof Error ? e.message : "unknown error"}). Enter it by hand.`); }
  return asOperator(driver, operatorId, async (q) => {
    const today = iso(new Date());
    if (got.date > today) throw new UserError("The page shows a future date. Not stored.");
    // a jump of more than 10% from the last stored rate is more likely a misread than a market move
    const last = (await q.query<{ buy: string }>("select buy::text from public.fx_rates where rate_date < $1::date order by rate_date desc limit 1", [got.date])).rows[0];
    if (last && Math.abs(got.buy / Number(last.buy) - 1) > 0.1) throw new UserError(`The fetched rate (${got.buy}) is more than 10% away from the last one (${last.buy}). Not stored. Check it and enter it by hand.`);
    const r = await q.query(
      `insert into public.fx_rates(rate_date, buy, sell, source) values ($1, $2, $3, 'forex.pk')
       on conflict (rate_date) do update set buy = excluded.buy, sell = excluded.sell, fetched_at = now() where public.fx_rates.source <> 'manual' returning rate_date`, [got.date, got.buy, got.sell]);
    return { ...got, stored: r.rows.length > 0 };
  });
}
