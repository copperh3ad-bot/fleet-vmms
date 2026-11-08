// Reading the activity log (ADR-070). Operator only: the operator check runs in the caller and again inside the query (asOperator). Reading the log is itself logged.
import type { Driver } from "@/lib/db/types";
import { asOperator } from "@/lib/billing/operator";
import { toCsv } from "@/lib/exports/csv";

export const ACTIVITY_KINDS = ["action", "page", "auth", "security", "webhook", "job", "error", "billing", "system"] as const;
export const ACTIVITY_OUTCOMES = ["ok", "denied", "invalid", "error", "info"] as const;
export const PAGE_SIZE = 100;
export const MAX_EXPORT = 20_000;

export type ActivityFilter = { kind?: string; outcome?: string; q?: string; from?: string; to?: string; tenant?: string; actor?: string; request?: string; page?: number };

export type ActivityRow = {
  id: string; at: string; kind: string; name: string; outcome: string; actor_id: string | null; actor_email: string | null; subject: string | null;
  tenant_id: string | null; tenant_name: string | null; role: string | null; request_id: string | null; path: string | null; method: string | null; status: number | null;
  duration_ms: number | null; ip: string | null; user_agent: string | null; error_class: string | null; error_message: string | null; error_digest: string | null; details: unknown;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

/** Turns the filter into a WHERE clause with numbered parameters. Anything not recognised is ignored rather than guessed at. */
export function whereOf(f: ActivityFilter): { sql: string; args: unknown[] } {
  const parts: string[] = [], args: unknown[] = [];
  const add = (sql: string, v: unknown) => { args.push(v); parts.push(sql.replace("$$", `$${args.length}`)); };
  if (f.kind && (ACTIVITY_KINDS as readonly string[]).includes(f.kind)) add("a.kind = $$", f.kind);
  if (f.outcome === "problem") parts.push("a.outcome in ('denied', 'error')");
  else if (f.outcome && (ACTIVITY_OUTCOMES as readonly string[]).includes(f.outcome)) add("a.outcome = $$", f.outcome);
  if (f.from && DATE.test(f.from)) add("a.at >= $$::date", f.from);
  if (f.to && DATE.test(f.to)) add("a.at < ($$::date + 1)", f.to);
  if (f.tenant && UUID.test(f.tenant)) add("a.tenant_id = $$", f.tenant);
  if (f.actor && UUID.test(f.actor)) add("a.actor_id = $$", f.actor);
  if (f.request) add("a.request_id = $$", f.request.slice(0, 80));
  const q = f.q?.trim().slice(0, 80);
  if (q) add("(a.name ilike $$ or a.subject ilike $$ or a.path ilike $$ or a.error_message ilike $$ or a.error_class ilike $$)", `%${q.replace(/[%_\\]/g, "\\$&")}%`);
  return { sql: parts.length ? `where ${parts.join(" and ")}` : "", args };
}

const COLS = `a.id::text, a.at::text, a.kind, a.name, a.outcome, a.actor_id::text, a.subject, a.tenant_id::text, t.name as tenant_name, a.role, a.request_id, a.path, a.method, a.status,
  a.duration_ms, a.ip, a.user_agent, a.error_class, a.error_message, a.error_digest, a.details`;

async function fetchRows(driver: Driver, operatorId: string, f: ActivityFilter, limit: number, offset: number): Promise<ActivityRow[]> {
  return asOperator(driver, operatorId, async (q) => {
    const w = whereOf(f);
    const rows = (await q.query<Omit<ActivityRow, "actor_email">>(
      `select ${COLS} from public.activity_log a left join public.tenants t on t.id = a.tenant_id ${w.sql} order by a.at desc, a.id desc limit ${limit} offset ${offset}`, w.args)).rows;
    // The sign-in email behind an actor id, where the database has Supabase's users table (it does not in the test database).
    const ids = [...new Set(rows.map((r) => r.actor_id).filter((x): x is string => !!x))];
    let emails = new Map<string, string>();
    if (ids.length && (await q.query<{ ok: boolean }>("select to_regclass('auth.users') is not null as ok")).rows[0].ok) {
      emails = new Map((await q.query<{ id: string; email: string }>("select id::text, email from auth.users where id::text = any($1::text[])", [ids])).rows.map((r) => [r.id, r.email]));
    }
    return rows.map((r) => ({ ...r, actor_email: r.actor_id ? emails.get(r.actor_id) ?? null : null }));
  });
}

export async function listActivity(driver: Driver, operatorId: string, f: ActivityFilter): Promise<{ rows: ActivityRow[]; page: number; more: boolean }> {
  const page = Math.max(1, Math.floor(f.page ?? 1));
  const rows = await fetchRows(driver, operatorId, f, PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
  return { rows: rows.slice(0, PAGE_SIZE), page, more: rows.length > PAGE_SIZE };
}

export async function activityCsv(driver: Driver, operatorId: string, f: ActivityFilter): Promise<{ csv: string; rows: number }> {
  const rows = await fetchRows(driver, operatorId, f, MAX_EXPORT, 0);
  const cols = ["at", "kind", "name", "outcome", "actor_email", "subject", "tenant_name", "role", "path", "method", "status", "duration_ms", "ip", "error_class", "error_message", "request_id", "details"] as const;
  const value = (r: ActivityRow, c: (typeof cols)[number]) => (c === "details" ? (r.details == null ? "" : JSON.stringify(r.details)) : (r[c] ?? ""));
  return { csv: toCsv(cols.map((c) => ({ header: c, value: (r: ActivityRow) => value(r, c) })), rows), rows: rows.length };
}
