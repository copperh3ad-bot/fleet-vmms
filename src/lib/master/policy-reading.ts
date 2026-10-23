// Reading an uploaded policy and applying what it says, for one company. Three steps, each its own call so no call is long:
//   start  -> looks at the file (PDF with text, scanned PDF, photo) and opens a reading
//   step   -> reads the next page; after the last page, works out the findings (policy-extract.ts)
//   apply  -> a person chooses findings; the SERVER's stored findings are applied, never values sent from the browser
// Needs policy.manage. Applying also needs the permission of what it changes (settings: policy.manage, service rules: service.manage).
import type { Driver } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import type { BlobStore } from "@/lib/jobcards/attachments";
import { getSettings, listServiceRules, saveServiceRule, saveSettings } from "@/lib/control/service";
import { inspectFile, readPage } from "@/lib/docs/read-file";
import { extractPolicy, type Finding } from "@/lib/docs/policy-extract";

export type ReadableStore = BlobStore & { get(path: string): Promise<Uint8Array | null> };

export type Progress = { status: "reading" | "ready" | "failed"; pagesDone: number; pagesTotal: number; error: string | null };
export type FindingView = Finding & { current: string | null; applied: boolean; actionable: boolean };
export type Reading = Progress & { kind: string | null; confidence: number | null; findings: FindingView[]; textLength: number };

type Row = { id: string; status: Progress["status"]; file_kind: string | null; pages_total: number; pages_done: number; page_text: string[]; confidence: number | null; findings: Finding[]; applied: string[]; error: string | null };
const COLS = "id, status, file_kind, pages_total, pages_done, page_text, confidence, findings, applied, error";

async function policyFile(q: import("@/lib/db/types").Queryable, m: Membership, policyId: string): Promise<string> {
  if ((await q.query("select 1 from maintenance_policies where id = $1", [policyId])).rows.length === 0) throw new UserError("Policy not found.");
  const path = (await q.query<{ storage_path: string }>("select storage_path from attachments where entity_type = 'maintenance_policy' and entity_id = $1 order by created_at limit 1", [policyId])).rows[0]?.storage_path;
  if (!path || !path.startsWith(`${m.schema}/`)) throw new UserError("This policy has no file to read.");
  return path;
}

async function fileBytes(store: ReadableStore, path: string): Promise<Uint8Array> {
  const bytes = await store.get(path).catch(() => null);
  if (!bytes) throw new UserError("The file could not be fetched. Try again.");
  return bytes;
}

const progress = (r: Row): Progress => ({ status: r.status, pagesDone: r.pages_done, pagesTotal: r.pages_total, error: r.error });

/** Opens (or restarts) the reading of this policy's file. Anything read before is replaced. */
export async function startReading(driver: Driver, store: ReadableStore, m: Membership, policyId: string): Promise<Progress> {
  const path = await authorized(driver, m, "policy.manage", (q) => policyFile(q, m, policyId));
  const info = await inspectFile(await fileBytes(store, path));
  return authorized(driver, m, "policy.manage", async (q) => {
    await q.query("delete from policy_readings where policy_id = $1", [policyId]);
    const r = (await q.query<Row>(
      `insert into policy_readings(policy_id, file_kind, pages_total, started_by) values ($1, $2, $3, $4) returning ${COLS}`, [policyId, info.kind, info.pages, m.userId])).rows[0];
    return progress(r);
  });
}

/** Reads the next page. Safe to call twice at once: only one of the two saves the page. */
export async function stepReading(driver: Driver, store: ReadableStore, m: Membership, policyId: string): Promise<Progress> {
  const { row, path } = await authorized(driver, m, "policy.manage", async (q) => {
    const r = (await q.query<Row>(`select ${COLS} from policy_readings where policy_id = $1`, [policyId])).rows[0];
    return { row: r, path: r && r.status === "reading" ? await policyFile(q, m, policyId) : "" };
  });
  if (!row) throw new UserError("Start reading this policy first.");
  if (row.status !== "reading") return progress(row);

  let text = "", confidence: number | null = null;
  try {
    const bytes = await fileBytes(store, path);
    const info = await inspectFile(bytes);
    const page = await readPage(bytes, info, row.pages_done + 1);
    text = page.text; confidence = page.confidence;
  } catch (e) {
    if (e instanceof UserError && /could not be fetched/.test(e.message)) throw e;              // transient: the screen may try again
    const message = e instanceof UserError ? e.message : "This file could not be read.";
    return authorized(driver, m, "policy.manage", async (q) => progress((await q.query<Row>(
      `update policy_readings set status = 'failed', error = $2, updated_at = now() where policy_id = $1 and pages_done = $3 returning ${COLS}`, [policyId, message, row.pages_done])).rows[0] ?? row));
  }

  return authorized(driver, m, "policy.manage", async (q) => {
    const next = row.pages_done + 1, last = next >= row.pages_total;
    const pages = [...row.page_text, text];
    const mean = confidence === null ? row.confidence : Math.round(((row.confidence ?? confidence) * row.pages_done + confidence) / next);
    const findings = last ? extractPolicy(pages.join("\n")) : [];
    const done = (await q.query<Row>(
      `update policy_readings set page_text = $2::jsonb, pages_done = $3, confidence = $4, status = $5, findings = $6::jsonb, updated_at = now()
        where policy_id = $1 and pages_done = $7 and status = 'reading' returning ${COLS}`,
      [policyId, JSON.stringify(pages), next, mean, last ? "ready" : "reading", JSON.stringify(findings), row.pages_done])).rows[0];
    if (done) return progress(done);
    return progress((await q.query<Row>(`select ${COLS} from policy_readings where policy_id = $1`, [policyId])).rows[0]);   // the other call won
  });
}

/** What was found, with what each setting is now, so the person sees the change before choosing it. */
export async function getReading(driver: Driver, m: Membership, policyId: string): Promise<Reading | null> {
  const r = await authorized(driver, m, "policy.manage", async (q) => (await q.query<Row>(`select ${COLS} from policy_readings where policy_id = $1`, [policyId])).rows[0]);
  if (!r) return null;
  // The settings are read after the first transaction has closed: a second one inside it would wait on the first.
  return { ...progress(r), kind: r.file_kind, confidence: r.confidence, textLength: r.page_text.join("").trim().length, findings: await view(driver, m, r) };
}

async function view(driver: Driver, m: Membership, r: Row): Promise<FindingView[]> {
  if (r.findings.length === 0) return [];
  const [settings, rules] = await Promise.all([getSettings(driver, m), listServiceRules(driver, m).catch(() => [])]);
  return r.findings.map((f) => {
    let current: string | null = null;
    if (f.target.kind === "setting") { const key = f.target.key; current = settings.find((s) => s.key === key)?.value ?? null; }
    if (f.target.kind === "service") {
      const name = f.target.name.toLowerCase(), rule = rules.find((x) => x.label.toLowerCase() === name);
      current = rule ? [rule.interval_months ? `every ${rule.interval_months} months` : "", rule.interval_km ? `every ${Number(rule.interval_km).toLocaleString("en-US")} km` : ""].filter(Boolean).join(" or ") || "no interval" : "not set up yet";
    }
    return { ...f, current, applied: r.applied.includes(f.id), actionable: f.target.kind !== "info" };
  });
}

/** Applies the chosen findings, from what the server stored. Returns a line for each thing changed. */
export async function applyFindings(driver: Driver, m: Membership, policyId: string, ids: string[]): Promise<string[]> {
  const r = await authorized(driver, m, "policy.manage", async (q) => (await q.query<Row>(`select ${COLS} from policy_readings where policy_id = $1`, [policyId])).rows[0]);
  if (!r || r.status !== "ready") throw new UserError("There is nothing ready to apply.");
  const chosen = r.findings.filter((f) => ids.includes(f.id) && f.target.kind !== "info");
  if (chosen.length === 0) throw new UserError("Choose at least one finding to apply.");
  const done: string[] = [], lines: string[] = [];

  const settingValues: Record<string, string> = {};
  const settingFindings = chosen.filter((f) => f.target.kind === "setting");
  for (const f of settingFindings) settingValues[(f.target as { key: string }).key] = f.value;
  if (settingFindings.length) {
    await saveSettings(driver, m, settingValues);                     // refuses a value the setting does not accept
    for (const f of settingFindings) { done.push(f.id); lines.push(`${f.label}: ${f.value}`); }
  }

  for (const f of chosen.filter((x) => x.target.kind === "service")) {
    const t = f.target as { kind: "service"; name: string; months?: number; km?: number };
    const rules = await listServiceRules(driver, m);
    const rule = rules.find((x) => x.label.toLowerCase() === t.name.toLowerCase());
    await saveServiceRule(driver, m, {
      ...(rule ? { key: rule.key } : {}), label: rule?.label ?? t.name, is_preventive: rule?.is_preventive ?? true, active: rule?.active ?? true,
      interval_months: t.months ?? rule?.interval_months ?? undefined, interval_km: t.km ?? rule?.interval_km ?? undefined,
      applies_to_classes: rule?.applies_to_classes ?? undefined,
    });
    done.push(f.id); lines.push(`${t.name}: ${f.value}`);
  }

  await authorized(driver, m, "policy.manage", (q) =>
    q.query("update policy_readings set applied = (select coalesce(jsonb_agg(distinct x), '[]'::jsonb) from jsonb_array_elements(applied || $2::jsonb) x), updated_at = now() where policy_id = $1", [policyId, JSON.stringify(done)]));
  return lines;
}
