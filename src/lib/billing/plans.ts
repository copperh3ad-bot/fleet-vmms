// Basic and Pro (ADR-035). A plan is a row in `plans`; Pro is priced in fleet-size BANDS in `plan_bands`. Every price is entered by the owner and lives in the
// database, never in code (CLAUDE.md rule 7). The plan an organization is on is `org_billing.plan_key`; the price it pays, and the daily allowance of AI readings
// its band gave it, are copies taken when it joined or renewed, so a later price change touches nobody already paying. Basic is the existing "standard" plan,
// renamed. Pro is Basic plus the AI features, and is not for sale until the owner has priced every fleet size.
import type { Driver } from "@/lib/db/types";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";
import { asOperator } from "./operator";
import { formatPrice, PRO_HEADLINE } from "./offer";
import { billedMonths } from "./months";

import { BASIC, PRO, vehicleCount } from "./quote";
export { BASIC, PRO, vehicleCount };
const DEFAULT_AI_PER_DAY = 60;
const MAX_BANDS = 6;

export type PlanRow = { key: string; name: string; price_cents: number | null; currency: string; trial_days: number; limits: Record<string, number | undefined>; features: Record<string, boolean | undefined> };
export type Band = { up_to_vehicles: number | null; price_cents: number; currency: string; ai_reads_per_day: number };

export function listPlans(driver: Driver): Promise<PlanRow[]> {
  return withPlatform(driver, async (q) => (await q.query<PlanRow>("select key, name, price_cents, currency, trial_days, limits, features from public.plans where key in ('standard', 'pro') order by (key = 'pro'), key")).rows);
}

export function listBands(driver: Driver, key = PRO): Promise<Band[]> {
  return withPlatform(driver, async (q) => (await q.query<Band>("select up_to_vehicles, price_cents, currency, ai_reads_per_day from public.plan_bands where plan_key = $1 order by coalesce(up_to_vehicles, 2147483647)", [key])).rows);
}

/** A set of bands is on sale only if it prices every fleet size: it must end in a band with no upper limit. */
export const bandsCoverEverySize = (bands: Band[]) => bands.length > 0 && bands[bands.length - 1].up_to_vehicles === null;

/** The band a fleet of this many vehicles falls in: the first whose upper limit it does not exceed. Null if none (the bands do not cover it). */
export function bandFor(bands: Band[], vehicles: number): Band | null {
  return bands.find((b) => b.up_to_vehicles === null || vehicles <= b.up_to_vehicles) ?? null;
}

/** What a public page may say about Pro: its prices only once the owner has entered bands that cover every size. */
export type ProOffer = { priced: boolean; headline: string; bands: { label: string; amount: string; yearly: string; readsPerDay: number }[]; per: string; trialDays: number; points: string[] };
export function proOfferFrom(plan: PlanRow | undefined, bands: Band[]): ProOffer {
  const priced = bandsCoverEverySize(bands);
  let from = 1;
  return {
    priced,
    headline: PRO_HEADLINE,
    bands: priced ? bands.map((b) => {
      const label = b.up_to_vehicles === null ? (from === 1 ? "Every fleet size" : `${from} vehicles or more`) : `${from} to ${b.up_to_vehicles} vehicles`;
      if (b.up_to_vehicles !== null) from = b.up_to_vehicles + 1;
      return { label, amount: formatPrice(b.price_cents, b.currency), yearly: formatPrice(b.price_cents * billedMonths(12), b.currency), readsPerDay: b.ai_reads_per_day };
    }) : [],
    per: "per month, per company",
    trialDays: plan?.trial_days ?? 0,
    points: [
      "Everything in Basic",
      "The AI reads the estimates and invoices your workshops email and fills in the form for you to check",
      "Staff raise a job card from one WhatsApp message; the AI drafts it and they confirm",
      "Employees say Hi on WhatsApp to raise a job card, ask for a cargo pick-up, reserve a trip or send an odometer reading, answering a few questions each time",
      "Send a trip to several logistics providers, compare their quotes, and check their invoices, with your own rate cards beside them",
      "The AI compares the providers' quotes and says which to lean towards and why; you decide who to award",
      "A person always checks and saves, so every approval still carries a real name and time",
      "Switched on by your administrator, and your records are never used to train AI",
      priced && bands.length === 1 ? "One price for every fleet size" : "The price follows the size of your fleet, because a larger fleet sends more documents to read",
    ],
  };
}
export const loadProOffer = async (driver: Driver): Promise<ProOffer> => proOfferFrom((await listPlans(driver)).find((p) => p.key === PRO), await listBands(driver, PRO));

/** What the plan an organization is on lets it do. An organization with no plan row (the ones that existed before billing) is on none, so has no AI until the operator moves it. */
export type TenantPlan = { key: string; name: string; aiDocuments: boolean; /** Pro: trips can be sent to logistics providers for quotes (ADR-078) */ outsourcedTrips: boolean; /** Pro: the WhatsApp menu and questionnaires (ADR-079) */ whatsappMenu: boolean; aiPerDay: number; aiTrialReads: number | null; trialing: boolean; /** while a Basic company's free Pro trial runs: when it ends (ADR-068) */ proTrialEndsAt: string | null };

export function planFrom(row: { plan_key: string | null; name: string | null; status: string | null; features: Record<string, boolean | undefined> | null; limits: Record<string, number | undefined> | null; ai_reads_per_day?: number | null } | undefined): TenantPlan {
  const features = row?.features ?? {}, limits = row?.limits ?? {};
  const aiDocuments = features.ai_documents === true;
  const trialing = row?.status === "trialing";
  return {
    key: row?.plan_key ?? "none", name: row?.name ?? "No plan", aiDocuments, outsourcedTrips: features.outsourced_trips === true, whatsappMenu: features.whatsapp_menu === true, trialing, proTrialEndsAt: null,
    aiPerDay: aiDocuments ? (row?.ai_reads_per_day ?? limits.ai_reads_per_day ?? DEFAULT_AI_PER_DAY) : 0,
    aiTrialReads: aiDocuments && trialing && typeof limits.ai_trial_reads === "number" ? limits.ai_trial_reads : null,
  };
}

/**
 * The plan in force right now, worked out from the dates with no write (ADR-068): a switch whose date has passed already counts, and during a Basic company's free Pro
 * trial the Pro features are on with Pro's daily allowance. The daily job saves the switch and closes the trial; nothing waits for it.
 */
export function tenantPlan(driver: Driver, tenantId: string): Promise<TenantPlan> {
  return withPlatform(driver, async (q) => {
    const b = (await q.query<{ plan_key: string; status: string; ai_reads_per_day: number | null; pending_plan_key: string | null; pending_plan_from: string | null; pending_ai_reads_per_day: number | null; pro_trial_ends_at: string | null }>(
      `select plan_key, status, ai_reads_per_day, pending_plan_key, pending_plan_from::text, pending_ai_reads_per_day, pro_trial_ends_at::text from public.org_billing where tenant_id = $1`, [tenantId])).rows[0];
    if (!b) return planFrom(undefined);
    const now = Date.now();
    const due = !!b.pending_plan_key && !!b.pending_plan_from && new Date(b.pending_plan_from).getTime() <= now;
    const key = due ? b.pending_plan_key! : b.plan_key;
    const reads = due ? b.pending_ai_reads_per_day : b.ai_reads_per_day;
    const trial = key === BASIC && !!b.pro_trial_ends_at && new Date(b.pro_trial_ends_at).getTime() > now;
    const rows = (await q.query<{ key: string; name: string; features: Record<string, boolean>; limits: Record<string, number> }>("select key, name, features, limits from public.plans where key in ('standard', 'pro')")).rows;
    const own = rows.find((x) => x.key === key), pro = rows.find((x) => x.key === PRO);
    if (!trial) return planFrom({ plan_key: key, name: own?.name ?? null, status: b.status, features: own?.features ?? null, limits: own?.limits ?? null, ai_reads_per_day: reads });
    const band = (await q.query<{ ai_reads_per_day: number }>("select ai_reads_per_day from public.plan_bands where plan_key = 'pro' order by coalesce(up_to_vehicles, 2147483647) limit 1")).rows[0];
    const p = planFrom({ plan_key: key, name: own?.name ?? null, status: b.status, features: pro?.features ?? null, limits: pro?.limits ?? null, ai_reads_per_day: band?.ai_reads_per_day ?? null });
    return { ...p, aiTrialReads: null, proTrialEndsAt: b.pro_trial_ends_at };
  });
}

// ------------------------------------------------------------------------------------------ the operator's side

/** An amount in dollars (or the plan's currency) to whole cents; throws on anything else. */
export function parsePrice(raw: string): number {
  const v = raw.trim().replace(/,/g, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(v) || Number(v) <= 0) throw new UserError("Enter an amount with at most two decimals, like 12.50.", { price: "Enter an amount, like 12.50" });
  return Math.round(Number(v) * 100);
}

/** The owner prices Basic. A change touches only organizations that join from then on; those already paying keep the price they joined at. */
export function setPlanPrice(driver: Driver, operatorId: string, key: string, input: { price: string; currency?: string; trialDays?: string }): Promise<void> {
  return asOperator(driver, operatorId, async (q) => {
    if (key !== BASIC && key !== PRO) throw new UserError("Unknown plan.");
    if (key === PRO) throw new UserError("Pro is priced by fleet size. Set its bands instead.");
    const cents = parsePrice(input.price);
    const currency = (input.currency ?? "USD").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new UserError("Use a three-letter currency code, like USD.", { currency: "Use a three-letter code" });
    const trial = input.trialDays === undefined || input.trialDays.trim() === "" ? null : Number(input.trialDays);
    if (trial !== null && (!Number.isInteger(trial) || trial < 0 || trial > 60)) throw new UserError("Trial days: a whole number from 0 to 60.", { trial_days: "0 to 60" });
    await q.query("update public.plans set price_cents = $2, currency = $3, trial_days = coalesce($4, trial_days) where key = $1", [key, cents, currency, trial]);
  });
}

export type BandInput = { upTo: string; price: string; reads: string };

/**
 * The owner sets Pro's bands in one go (replacing the old ones), or takes Pro off sale by sending no rows. The bands must go up in size, each with a price and a
 * daily allowance of readings, and end in one with no upper limit so that every fleet has a price. Organizations already on Pro keep what they joined at.
 */
export function setProBands(driver: Driver, operatorId: string, rows: BandInput[], currencyIn = "USD"): Promise<void> {
  return asOperator(driver, operatorId, async (q) => {
    const used = rows.filter((r) => r.upTo.trim() !== "" || r.price.trim() !== "" || r.reads.trim() !== "");
    const currency = currencyIn.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new UserError("Use a three-letter currency code, like USD.", { currency: "Use a three-letter code" });
    if (used.length > MAX_BANDS) throw new UserError(`At most ${MAX_BANDS} bands.`);
    const parsed = used.map((r, i): Band => {
      const last = i === used.length - 1;
      const upTo = r.upTo.trim() === "" ? null : Number(r.upTo.trim());
      if (upTo !== null && (!Number.isInteger(upTo) || upTo < 1 || upTo > 1_000_000)) throw new UserError(`Band ${i + 1}: the number of vehicles must be a whole number above 0.`, { up_to: "Whole number above 0" });
      if (upTo === null && !last) throw new UserError(`Band ${i + 1}: only the last band may have no upper limit.`, { up_to: "Only the last band" });
      if (upTo !== null && last) throw new UserError("The last band must have no upper limit, so every fleet size has a price.", { up_to: "Leave empty on the last band" });
      const reads = Number(r.reads.trim());
      if (!Number.isInteger(reads) || reads < 1 || reads > 100_000) throw new UserError(`Band ${i + 1}: readings per day must be a whole number above 0.`, { reads: "Whole number above 0" });
      return { up_to_vehicles: upTo, price_cents: parsePrice(r.price), currency, ai_reads_per_day: reads };
    });
    for (let i = 1; i < parsed.length; i++) if (parsed[i].up_to_vehicles !== null && parsed[i].up_to_vehicles! <= parsed[i - 1].up_to_vehicles!) throw new UserError(`Band ${i + 1} must be larger than band ${i}.`, { up_to: "Must go up" });
    await q.query("delete from public.plan_bands where plan_key = 'pro'");
    for (const b of parsed) await q.query("insert into public.plan_bands(plan_key, up_to_vehicles, price_cents, currency, ai_reads_per_day) values ('pro', $1, $2, $3, $4)", [b.up_to_vehicles, b.price_cents, b.currency, b.ai_reads_per_day]);
  });
}

/**
 * Who is offered Pro (ADR-035): organizations that enter MORE than this many job cards a day, on average over the last 30 days. Job cards are what the AI's work grows with
 * (each repair brings an estimate and an invoice), so this is the measure, not the number of vehicles. The owner's setting; 20 until they change it.
 */
export const DEFAULT_PRO_MIN_JOB_CARDS = 20;
export const PRO_WINDOW_DAYS = 30;
export const proEligible = (jobCardsPerDay: number, min: number = DEFAULT_PRO_MIN_JOB_CARDS) => jobCardsPerDay > min;
export async function proMinJobCards(driver: Driver): Promise<number> {
  const v = await withPlatform(driver, async (q) => (await q.query<{ value: string }>("select value from public.platform_settings where key = 'pro_offer_min_job_cards'")).rows[0]?.value);
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && v !== undefined && v.trim() !== "" ? n : DEFAULT_PRO_MIN_JOB_CARDS;
}

/** The average number of job cards an organization entered per day over the last 30 days, counted in its own workspace. Drafts count: they are entered work. */
export async function jobCardsPerDay(driver: Driver, schema: string): Promise<number> {
  const n = await withTenant(driver, { schema, userId: "00000000-0000-0000-0000-000000000000", role: "billing" }, async (q) =>
    Number((await q.query<{ n: string }>(`select count(*)::text n from job_cards where created_at >= now() - interval '${PRO_WINDOW_DAYS} days'`)).rows[0].n)).catch(() => 0);
  return n / PRO_WINDOW_DAYS;
}

/**
 * The operator moves one organization to a plan (for a test, a gift or a correction), or re-bands it after its fleet has grown. Moving to Pro takes the price and the
 * daily allowance of the band its fleet falls in. If Pro has no bands, it cannot be given unless the organization is comped (billing waived), which is how the
 * owner tries Pro on their own organization. The operator may move any organization; the "more than N job cards a day" rule is for what is offered to customers.
 */
export async function setOrgPlan(driver: Driver, operatorId: string, tenantId: string, key: string): Promise<void> {
  if (key !== BASIC && key !== PRO) throw new UserError("Unknown plan.");
  // The vehicles are counted first and on their own: the count opens its own connection, which must not happen while this one holds a lock.
  const schema = await asOperator(driver, operatorId, async (q) => (await q.query<{ schema_name: string }>("select t.schema_name from public.org_billing b join public.tenants t on t.id = b.tenant_id where b.tenant_id = $1", [tenantId])).rows[0]?.schema_name);
  if (!schema) throw new UserError("That organization has no billing record.");
  const vehicles = key === PRO ? await vehicleCount(driver, tenantId, schema) : 0;
  return asOperator(driver, operatorId, async (q) => {
    const b = (await q.query<{ comped: boolean }>("select comped from public.org_billing where tenant_id = $1 for update", [tenantId])).rows[0];
    if (!b) throw new UserError("That organization has no billing record.");
    let price: number | null = null, currency: string | null = null, reads: number | null = null;
    if (key === BASIC) {
      const p = (await q.query<{ price_cents: number | null; currency: string }>("select price_cents, currency from public.plans where key = 'standard'")).rows[0];
      price = p?.price_cents ?? null; currency = p?.currency ?? null;
    } else {
      const bands = (await q.query<Band>("select up_to_vehicles, price_cents, currency, ai_reads_per_day from public.plan_bands where plan_key = 'pro' order by coalesce(up_to_vehicles, 2147483647)")).rows;
      if (bandsCoverEverySize(bands)) {
        const band = bandFor(bands, vehicles)!;
        price = band.price_cents; currency = band.currency; reads = band.ai_reads_per_day;
      } else if (!b.comped) throw new UserError("Pro has no prices yet. Set its bands on the Plans page first, or waive billing for this organization.");
    }
    const was = (await q.query<{ plan_key: string }>("select plan_key from public.org_billing where tenant_id = $1", [tenantId])).rows[0]?.plan_key;
    await q.query(
      `update public.org_billing set plan_key = $2, price_cents = coalesce($3, price_cents), currency = coalesce($4, currency), ai_reads_per_day = $5,
              pending_plan_key = null, pending_plan_from = null, pending_price_cents = null, pending_currency = null, pending_ai_reads_per_day = null, updated_at = now() where tenant_id = $1`,
      [tenantId, key, price, currency, reads]);
    await q.query("insert into public.plan_changes(tenant_id, from_plan, to_plan, reason, changed_by) values ($1, $2, $3, 'operator', $4)", [tenantId, was ?? null, key, operatorId]);
  });
}
