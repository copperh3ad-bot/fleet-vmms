// Makes and models the built-in list does not have (ADR-071). Pakistan has grey imports, rebuilt vehicles, local builds and older models no list will cover, so a fleet owner
// can always type the name and the vehicle is saved at once. The name is recorded for the operator, who approves it into everyone's drop-down, merges it into a name that
// exists, or rejects it. Until decided, only the company that typed it sees it in its own drop-down.
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { asOperator } from "@/lib/billing/operator";
import { UserError } from "@/lib/master/service";
import { CATALOG, builtinMake, builtinModel, nameKey, type CatalogExtras } from "./vehicle-catalog";
import type { Queryable } from "@/lib/db/types";

export { nameKey, mergeCatalog, type Catalog, type CatalogExtras } from "./vehicle-catalog";

export const MAX_MAKE = 40, MAX_MODEL = 60;
/** One company can add this many new names a day to the review queue; the vehicles are still saved. It stops a script from flooding the operator. */
export const MAX_NEW_NAMES_PER_DAY = 40;

/**
 * A name as it may be kept: spaces tidied, a sensible length, plain characters, nothing that looks like a web address or an email. Returns null if it cannot be kept
 * (the vehicle is still saved with what was typed; it just is not offered for review).
 */
export function cleanName(raw: string, max: number): string | null {
  const s = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (s.length < 1 || s.length > max) return null;
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .,'&/+()\-]*$/u.test(s)) return null;
  if (/https?:|www\.|@|\.(com|pk|net|org)\b/i.test(s)) return null;
  if (nameKey(s) === "") return null;
  return s;
}

type Row = { make: string; model: string | null; status: string };

export async function loadCatalogExtras(driver: Driver, tenantId: string): Promise<CatalogExtras> {
  const rows = await withPlatform(driver, async (q) => (await q.query<Row>(
    `select s.make, s.model, s.status from public.vehicle_name_suggestions s
      where s.status = 'approved' or (s.status = 'pending' and exists (select 1 from public.vehicle_name_uses u where u.suggestion_id = s.id and u.tenant_id = $1))
      order by s.make_key, s.model_key`, [tenantId])).rows).catch((): Row[] => []);        // before the table exists, or if it cannot be read: the built-in list alone
  const extras: CatalogExtras = { makes: [], models: {} };
  for (const r of rows) {
    const make = builtinMake(r.make) ?? r.make;
    if (!r.model) { if (!builtinMake(r.make)) extras.makes.push(make); continue; }
    if (!builtinMake(r.make) && !extras.makes.includes(make)) extras.makes.push(make);        // a model's make is offered with it
    (extras.models[make] ??= []).push(r.model);
  }
  return extras;
}

// ---- what is saved ------------------------------------------------------------------------------------------------------------------------------------------------
export type Canonical = { make: string; model: string };

/**
 * The spelling to save. A name that matches the built-in list, an approved name or a merged one is saved in its settled spelling, so "toyota" and "TOYOTA" do not become
 * two makes in a company's reports. Anything else is kept as typed. Reads only; recordNames does the recording.
 */
export async function canonicalNames(driver: Driver, make: string, model: string): Promise<Canonical> {
  const bm = builtinMake(make);
  const rows = await withPlatform(driver, async (q) => (await q.query<{ make: string; model: string | null; status: string; merged_make: string | null; merged_model: string | null }>(
    "select make, model, status, merged_make, merged_model from public.vehicle_name_suggestions where make_key = $1 and status in ('approved', 'merged')", [nameKey(bm ?? make)])).rows)
    .catch(() => []);        // never hold up a vehicle: if the names cannot be read, it is saved as typed
  let outMake = bm ?? make;
  const makeRow = rows.find((r) => r.model === null);
  if (!bm && makeRow) outMake = makeRow.status === "merged" ? makeRow.merged_make ?? makeRow.make : makeRow.make;
  let outModel = model;
  const bModel = builtinModel(outMake, model);
  if (bModel) outModel = bModel;
  else {
    const modelRow = rows.find((r) => r.model !== null && nameKey(r.model) === nameKey(model));
    if (modelRow) outModel = modelRow.status === "merged" ? modelRow.merged_model ?? modelRow.model! : modelRow.model!;
    else if (makeRow?.status === "merged") { /* the make was folded into another: the model is kept as typed under it */ }
  }
  return { make: outMake, model: outModel };
}

/** Records the make and model of a vehicle that has just been saved. Never throws and never holds the vehicle up. */
export async function recordNames(driver: Driver, tenantId: string, make: string, model: string): Promise<void> {
  try {
    const mk = cleanName(make, MAX_MAKE), md = cleanName(model, MAX_MODEL);
    if (!mk) return;
    const makeKnown = !!builtinMake(mk);
    const modelKnown = !!(md && builtinModel(builtinMake(mk) ?? mk, md));
    if (makeKnown && (modelKnown || !md)) return;
    await withPlatform(driver, async (q) => {
      const recent = Number((await q.query<{ n: string }>("select count(*)::text as n from public.vehicle_name_uses where tenant_id = $1 and first_used > now() - interval '1 day'", [tenantId])).rows[0].n);
      const touch = async (name: string, mdl: string | null) => {
        const r = (await q.query<{ id: string; status: string }>(
          `insert into public.vehicle_name_suggestions(make, model, make_key, model_key, first_tenant_id) values ($1, $2, $3, $4, $5)
             on conflict (make_key, model_key) do update set uses = vehicle_name_suggestions.uses + 1, last_seen = now()
             where vehicle_name_suggestions.status <> 'rejected'
           returning id, status`, [name, mdl, nameKey(name), mdl ? nameKey(mdl) : "", tenantId])).rows[0];
        if (r) await q.query("insert into public.vehicle_name_uses(suggestion_id, tenant_id) values ($1, $2) on conflict do nothing", [r.id, tenantId]);
      };
      // a name already in the queue only counts another use; a brand-new one is limited per company per day
      const exists = async (name: string, mdl: string | null) => (await q.query("select 1 from public.vehicle_name_suggestions where make_key = $1 and model_key = $2", [nameKey(name), mdl ? nameKey(mdl) : ""])).rows.length > 0;
      const allowNew = recent < MAX_NEW_NAMES_PER_DAY;
      if (!makeKnown && (allowNew || (await exists(mk, null)))) await touch(mk, null);
      if (md && !modelKnown && (allowNew || (await exists(mk, md)))) await touch(builtinMake(mk) ?? mk, md);
    });
  } catch { /* the review queue must never stop a vehicle being saved */ }
}

// ---- the operator's queue ------------------------------------------------------------------------------------------------------------------------------------------
export type Suggestion = {
  id: string; make: string; model: string | null; status: string; uses: number; companies: number; first_seen: string; last_seen: string;
  first_company: string | null; merged_make: string | null; merged_model: string | null; decision_note: string | null; decided_at: string | null;
};

export type QueueView = "pending" | "approved" | "merged" | "rejected";

export function listSuggestions(driver: Driver, operatorId: string, view: QueueView = "pending"): Promise<Suggestion[]> {
  return asOperator(driver, operatorId, async (q) => (await q.query<Suggestion>(
    `select s.id, s.make, s.model, s.status, s.uses, (select count(*)::int from public.vehicle_name_uses u where u.suggestion_id = s.id) as companies,
            s.first_seen::text, s.last_seen::text, t.name as first_company, s.merged_make, s.merged_model, s.decision_note, s.decided_at::text
       from public.vehicle_name_suggestions s left join public.tenants t on t.id = s.first_tenant_id
      where s.status = $1 order by s.uses desc, s.first_seen limit 300`, [view])).rows);
}

/** The names a suggestion can be merged into: the built-in list and what has been approved. */
export function mergeTargets(driver: Driver, operatorId: string): Promise<Record<string, string[]>> {
  return asOperator(driver, operatorId, async (q) => {
    const out: Record<string, string[]> = Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [k, [...v]]));
    for (const r of (await q.query<{ make: string; model: string | null }>("select make, model from public.vehicle_name_suggestions where status = 'approved' order by make_key, model_key")).rows) {
      const make = builtinMake(r.make) ?? r.make;
      out[make] ??= [];
      if (r.model && !out[make].some((x) => nameKey(x) === nameKey(r.model!))) out[make].push(r.model);
    }
    return out;
  });
}

async function load(q: Queryable, id: string) {
  const s = (await q.query<{ id: string; make: string; model: string | null; make_key: string; model_key: string; status: string }>("select id, make, model, make_key, model_key, status from public.vehicle_name_suggestions where id = $1 for update", [id])).rows[0];
  if (!s) throw new UserError("That name is no longer in the queue.");
  return s;
}

/** Accepts the name into everyone's drop-down. The operator may correct the spelling or the capitals, not the name itself. A model brings its make with it. */
export function approveSuggestion(driver: Driver, operatorId: string, id: string, spelling: { make?: string; model?: string } = {}): Promise<void> {
  return asOperator(driver, operatorId, async (q) => {
    const s = await load(q, id);
    if (s.status !== "pending") throw new UserError("That name has already been decided.");
    const make = cleanName(spelling.make ?? s.make, MAX_MAKE);
    const model = s.model === null ? null : cleanName(spelling.model ?? s.model, MAX_MODEL);
    if (!make || (s.model !== null && !model)) throw new UserError("Use letters and numbers, up to 40 characters for a make and 60 for a model.");
    if (nameKey(make) !== s.make_key || (model && nameKey(model) !== s.model_key)) throw new UserError("You can fix the spelling or the capitals. To use a different name, merge this one into it.");
    await q.query("update public.vehicle_name_suggestions set status = 'approved', make = $2, model = $3, decided_by = $4, decided_at = now() where id = $1", [id, make, model, operatorId]);
    if (model !== null) {
      // the make a model belongs to is offered with it: approve it too, or bring it in already approved
      await q.query(
        `insert into public.vehicle_name_suggestions(make, model, make_key, model_key, status, decided_by, decided_at, uses)
           values ($1, null, $2, '', 'approved', $3, now(), 1)
         on conflict (make_key, model_key) do update set status = 'approved', make = excluded.make, decided_by = excluded.decided_by, decided_at = now()
           where vehicle_name_suggestions.status = 'pending'`, [make, s.make_key, operatorId]);
    }
  });
}

/** Folds the name into one that exists (a spelling variant). Vehicles already saved keep what their owners typed; new ones are saved with the settled name. */
export function mergeSuggestion(driver: Driver, operatorId: string, id: string, into: { make: string; model?: string | null }): Promise<void> {
  return asOperator(driver, operatorId, async (q) => {
    const s = await load(q, id);
    if (s.status !== "pending") throw new UserError("That name has already been decided.");
    const targets = await (async () => {
      const out: Record<string, string[]> = Object.fromEntries(Object.entries(CATALOG).map(([k, v]) => [k, [...v]]));
      for (const r of (await q.query<{ make: string; model: string | null }>("select make, model from public.vehicle_name_suggestions where status = 'approved'")).rows) {
        const make = builtinMake(r.make) ?? r.make; out[make] ??= []; if (r.model) out[make].push(r.model);
      }
      return out;
    })();
    const make = Object.keys(targets).find((m) => nameKey(m) === nameKey(into.make));
    if (!make) throw new UserError("Choose a make that is already on the list.");
    let model: string | null = null;
    if (s.model !== null) {
      model = (into.model ? targets[make].find((m) => nameKey(m) === nameKey(into.model!)) : undefined) ?? null;
      if (!model) throw new UserError("Choose a model that is already on the list for that make.");
    }
    if (nameKey(make) === s.make_key && (model === null ? s.model_key === "" : nameKey(model) === s.model_key)) throw new UserError("That is the same name. Approve it instead.");
    await q.query("update public.vehicle_name_suggestions set status = 'merged', merged_make = $2, merged_model = $3, decided_by = $4, decided_at = now() where id = $1", [id, make, model, operatorId]);
  });
}

/** Turns the name down: it is not offered to anyone, and the company's own vehicles keep what they typed. */
export function rejectSuggestion(driver: Driver, operatorId: string, id: string, note: string): Promise<void> {
  return asOperator(driver, operatorId, async (q) => {
    const s = await load(q, id);
    if (s.status !== "pending") throw new UserError("That name has already been decided.");
    await q.query("update public.vehicle_name_suggestions set status = 'rejected', decision_note = $2, decided_by = $3, decided_at = now() where id = $1", [id, note.trim().slice(0, 300) || null, operatorId]);
  });
}
