// The AI compares the quotes on one trip (ADR-080). A Pro feature on top of outsourced trips: it ranks the quoted options with reasons, from the quote, the company's
// own rate cards for that provider and the provider's history with this company. It is advice only. Awarding is still the person's click through awardTripQuote, which
// runs the same permission and segregation-of-duties checks. The model sees options A, B, C, each with the provider's business name (owner decision 2026-11-14, amends ADR-080). No people's names are sent.
import type { Driver } from "@/lib/db/types";
import type { Membership } from "@/lib/auth/can";
import { fleetAuthorized as authorized } from "@/lib/billing/fleet-ops";
import { UserError } from "@/lib/master/service";
import { tenantPlan } from "@/lib/billing/plans";
import { allowShared } from "@/lib/rate-limit";
import { adviseQuotes, aiConfigured, type CreateMessage } from "@/lib/ai/claude";
import { AI_READS_PER_PERSON_PER_HOUR, aiDocumentsEnabled } from "@/lib/ai/service";
import type { QuoteAdvice } from "@/lib/ai/quote-advice";
import { requireOn, requireOutsourcing } from "./service";

const HOUR = 3600, DAY = 86_400;
const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const MAX_ADVISED_QUOTES = 12;

/** Is the "Compare with AI" button offered here? The server has the AI, the plan includes it and the administrator has switched it on. */
export async function quoteAdviceOffered(driver: Driver, m: Membership): Promise<boolean> {
  const plan = await tenantPlan(driver, m.tenantId);
  return aiConfigured() && plan.aiDocuments && plan.outsourcedTrips && (await aiDocumentsEnabled(driver, m.tenantId));
}

type Option = {
  label: string; quote_id: string; provider: string; amount: number; over_lowest_pct: number; vehicle: string | null; notes: string | null; valid_until: string | null; hours_to_answer: number | null;
  rate_cards: { label: string; basis: string; amount: number }[];
  history: { trips_completed: number; invoices: number; invoices_returned: number; invoices_above_award: number; quotes_given: number; quotes_declined: number; avg_hours_to_answer: number | null };
};

/** Asks the AI to compare the quotes that have come in for a trip that is still waiting for approval. Stores and returns the advice; nothing about the trip or quotes changes. */
export async function recommendTripQuotes(driver: Driver, m: Membership, tripId: string, create?: CreateMessage): Promise<{ id: string; advice: QuoteAdvice }> {
  if (!aiConfigured()) throw new UserError("The AI is not switched on for this service yet. Compare the quotes by hand.");
  await requireOutsourcing(driver, m);
  const plan = await tenantPlan(driver, m.tenantId);
  if (!plan.aiDocuments) throw new UserError("Comparing quotes with AI is part of the Pro plan. Compare them by hand, or ask your administrator about upgrading in Billing.");
  if (!(await aiDocumentsEnabled(driver, m.tenantId))) throw new UserError("Your administrator has not switched on the AI for this organization. Compare the quotes by hand.");

  const loaded = await authorized(driver, m, "trip.award", async (q) => {
    await requireOn(q);
    const t = (await q.query<{ status: string; kind: string; purpose: string; from_place: string; to_place: string; stops: string | null; passengers: number | null; start_at: string; end_at: string; preferred: string | null }>(
      `select t.status, t.kind, t.purpose, t.from_place, t.to_place, t.stops, t.passengers, t.start_at::text, t.end_at::text, nullif(trim(concat_ws(' ', pv.make, pv.model)), '') as preferred
         from trips t left join vehicles pv on pv.id = t.preferred_vehicle_id where t.id = $1`, [tripId])).rows[0];
    if (!t) throw new UserError("Trip not found.");
    if (t.status !== "requested") throw new UserError("Quotes can only be compared while the trip is waiting for approval.");
    const quotes = (await q.query<{ id: string; vendor_id: string; provider: string; amount: string; vehicle_text: string | null; notes: string | null; valid_until: string | null; hours: string | null }>(
      `select id, vendor_id, (select name from vendors where id = vendor_id) as provider, amount::text, vehicle_text, notes, valid_until::text, round((extract(epoch from quoted_at - requested_at) / 3600)::numeric, 1)::text as hours
         from trip_quotes where trip_id = $1 and status = 'quoted' order by id limit ${MAX_ADVISED_QUOTES}`, [tripId])).rows;
    if (quotes.length < 2) throw new UserError("There is nothing to compare yet. At least two providers need to have quoted.");
    const options: Option[] = [];
    const lowest = Math.min(...quotes.map((x) => Number(x.amount)));
    for (const [i, x] of quotes.entries()) {
      const rates = (await q.query<{ label: string; basis: string; amount: string }>("select label, basis, amount::text from provider_rates where vendor_id = $1 and active order by label limit 8", [x.vendor_id])).rows;
      const h = (await q.query<{ trips_completed: string; invoices: string; invoices_returned: string; invoices_above_award: string; quotes_given: string; quotes_declined: string; avg_hours: string | null }>(
        `select (select count(*) from trips where outsourced_vendor_id = $1 and status = 'completed')::text as trips_completed,
                (select count(*) from trip_invoices where vendor_id = $1)::text as invoices,
                (select count(*) from trip_invoices where vendor_id = $1 and status = 'disputed')::text as invoices_returned,
                (select count(*) from trip_invoices ti join trips tr on tr.id = ti.trip_id where ti.vendor_id = $1 and tr.award_amount is not null and ti.amount > tr.award_amount)::text as invoices_above_award,
                (select count(*) from trip_quotes where vendor_id = $1 and trip_id <> $2 and status in ('quoted','awarded','closed') and quoted_at is not null)::text as quotes_given,
                (select count(*) from trip_quotes where vendor_id = $1 and trip_id <> $2 and status = 'declined')::text as quotes_declined,
                (select round(avg(extract(epoch from quoted_at - requested_at) / 3600)::numeric, 1) from trip_quotes where vendor_id = $1 and trip_id <> $2 and quoted_at is not null)::text as avg_hours`,
        [x.vendor_id, tripId])).rows[0];
      options.push({
        label: LABELS[i], quote_id: x.id, provider: x.provider.slice(0, 80), amount: Number(x.amount), over_lowest_pct: lowest > 0 ? Math.round(((Number(x.amount) - lowest) / lowest) * 1000) / 10 : 0,
        vehicle: x.vehicle_text, notes: x.notes ? x.notes.slice(0, 300) : null, valid_until: x.valid_until, hours_to_answer: x.hours === null ? null : Number(x.hours),
        rate_cards: rates.map((r) => ({ label: r.label, basis: r.basis, amount: Number(r.amount) })),
        history: {
          trips_completed: Number(h.trips_completed), invoices: Number(h.invoices), invoices_returned: Number(h.invoices_returned), invoices_above_award: Number(h.invoices_above_award),
          quotes_given: Number(h.quotes_given), quotes_declined: Number(h.quotes_declined), avg_hours_to_answer: h.avg_hours === null ? null : Number(h.avg_hours),
        },
      });
    }
    return { trip: t, options };
  });

  if (plan.aiTrialReads !== null) {
    const used = await authorized(driver, m, "trip.award", async (q) => Number((await q.query<{ n: string }>("select count(*)::text n from ai_actions where status <> 'failed'")).rows[0].n));
    if (used >= plan.aiTrialReads) throw new UserError(`Your trial includes ${plan.aiTrialReads} uses of the AI and they are used up. Pay for Pro in Billing to keep going, or compare the quotes by hand.`);
  }
  const [orgOk, personOk] = await Promise.all([allowShared(driver, `ai-read-org:${m.tenantId}`, plan.aiPerDay, DAY), allowShared(driver, `ai-read-user:${m.userId}`, AI_READS_PER_PERSON_PER_HOUR, HOUR)]);
  if (!orgOk || !personOk) throw new UserError("The limit for using the AI has been reached for now. Try again later, or compare the quotes by hand.");

  const { trip, options } = loaded;
  const labels = options.map((o) => o.label);
  const r = await adviseQuotes({
    trip: {
      kind: trip.kind === "pick_drop" ? "staff pick and drop" : "trip", purpose: trip.purpose.slice(0, 300), from: trip.from_place, to: trip.to_place, other_stops: trip.stops?.slice(0, 300) ?? null,
      passengers: trip.passengers, preferred_vehicle: trip.preferred, leaves: trip.start_at, returns: trip.end_at,
    },
    options: options.map(({ quote_id: _id, ...o }) => o),
  }, labels, create);

  const advice = r.status === "ok" ? r.advice : null;
  const map = options.map((o) => ({ label: o.label, quote_id: o.quote_id }));
  const id = await authorized(driver, m, "trip.award", async (q) => (await q.query<{ id: string }>(
    `insert into ai_actions(kind, trip_id, model, status, reason, draft, input_tokens, output_tokens, cache_write_tokens, cache_read_tokens, requested_by)
     values ('quote_advice', $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10) returning id`,
    [tripId, r.model, r.status, r.status === "ok" ? null : r.reason, advice ? JSON.stringify({ ...advice, options: map }) : null, r.inputTokens, r.outputTokens, r.cacheWriteTokens, r.cacheReadTokens, m.userId])).rows[0].id);
  if (!advice) throw new UserError((r as { reason: string }).reason);
  return { id, advice };
}

export type StoredAdvice = { id: string; created_at: string; stale: boolean; summary: string; warnings: string[]; ranking: { quote_id: string; label: string; reason: string; concerns: string[] }[] };

/**
 * The latest comparison for a trip, for the page. It is marked stale when the quotes have changed since: a quote added, corrected or withdrawn, so the person knows
 * to ask again before relying on it.
 */
export function latestQuoteAdvice(driver: Driver, m: Membership, tripId: string): Promise<StoredAdvice | null> {
  return authorized(driver, m, "trip.award", async (q) => {
    const a = (await q.query<{ id: string; created_at: string; draft: QuoteAdvice & { options: { label: string; quote_id: string }[] } }>(
      "select id, created_at::text, draft from ai_actions where kind = 'quote_advice' and trip_id = $1 and status = 'ok' order by created_at desc limit 1", [tripId])).rows[0];
    if (!a) return null;
    const now = (await q.query<{ id: string; changed: boolean }>("select id, coalesce(quoted_at > $2::timestamptz, false) as changed from trip_quotes where trip_id = $1 and status = 'quoted'", [tripId, a.created_at])).rows;
    const advised = new Set(a.draft.options.map((o) => o.quote_id));
    const stale = now.length !== advised.size || now.some((x) => !advised.has(x.id) || x.changed);
    const byLabel = new Map(a.draft.options.map((o) => [o.label, o.quote_id]));
    return {
      id: a.id, created_at: a.created_at, stale, summary: a.draft.summary, warnings: a.draft.warnings,
      ranking: a.draft.ranking.filter((r) => byLabel.has(r.label)).map((r) => ({ quote_id: byLabel.get(r.label)!, label: r.label, reason: r.reason, concerns: r.concerns })),
    };
  });
}
