// Creates and destroys the dedicated database of one organization (ADR-014). The rest of the app only knows this
// interface. "neon" makes a Neon project through its API; "local" makes a database on a local Postgres for development
// and tests. A connection string is a secret: callers encrypt it at once and never log it.
import { Client } from "pg";
import { randomBytes } from "node:crypto";

export type NewDb = { ref: string; url: string };
export interface DbProvider {
  readonly name: string;
  create(input: { name: string; region?: string }): Promise<NewDb>;
  /** Removes the database for good. Only called for a database that never went live, or by an operator's typed confirmation. */
  destroy(ref: string): Promise<void>;
}

// ---------------------------------------------------------------------------------------------- Neon

type Fetch = typeof fetch;
const NEON_API = "https://console.neon.tech/api/v2";

export function neonProvider(opts: { apiKey: string; region?: string; fetch?: Fetch; pgVersion?: number }): DbProvider {
  const f = opts.fetch ?? fetch;
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await f(`${NEON_API}${path}`, {
      method, headers: { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      // The body may repeat what we sent; report only the status and the provider's own message field.
      let msg = "";
      try { msg = String(((await res.json()) as { message?: string }).message ?? ""); } catch { /* no body */ }
      throw new Error(`Neon ${method} ${path.split("/").slice(0, 3).join("/")} failed (${res.status})${msg ? `: ${msg.slice(0, 200)}` : ""}`);
    }
    return res.status === 204 ? {} : ((await res.json()) as Record<string, unknown>);
  };
  return {
    name: "neon",
    async create({ name, region }) {
      const r = (await call("POST", "/projects", { project: { name: name.slice(0, 60), region_id: region ?? opts.region ?? "aws-ap-southeast-1", pg_version: opts.pgVersion ?? 16 } })) as {
        project?: { id?: string }; connection_uris?: { connection_uri?: string; connection_parameters?: { database?: string; role?: string; password?: string; host?: string; pooler_host?: string } }[];
      };
      const id = r.project?.id, c = r.connection_uris?.[0];
      if (!id || !c) throw new Error("Neon did not return a project.");
      const p = c.connection_parameters;
      // Prefer the pooled host: many serverless copies share few real connections.
      const url = p?.role && p.password && (p.pooler_host ?? p.host) && p.database
        ? `postgresql://${encodeURIComponent(p.role)}:${encodeURIComponent(p.password)}@${p.pooler_host ?? p.host}/${p.database}?sslmode=require`
        : c.connection_uri;
      if (!url) throw new Error("Neon did not return a connection.");
      return { ref: id, url };
    },
    async destroy(ref) {
      if (!/^[a-z0-9-]{3,64}$/.test(ref)) throw new Error("Not a database reference.");
      await call("DELETE", `/projects/${ref}`);
    },
  };
}

// ---------------------------------------------------------------------------------------------- local

/** A new database on the Postgres that `adminUrl` points at. The role in adminUrl must be allowed to create databases. */
export function localProvider(adminUrl: string): DbProvider {
  const withDb = (db: string) => { const u = new URL(adminUrl); u.pathname = `/${db}`; return u.toString(); };
  const admin = async <T,>(fn: (c: Client) => Promise<T>) => {
    const c = new Client({ connectionString: adminUrl });
    await c.connect();
    try { return await fn(c); } finally { await c.end().catch(() => undefined); }
  };
  return {
    name: "local",
    async create() {
      const db = `org_${randomBytes(8).toString("hex")}`;
      await admin((c) => c.query(`create database "${db}"`));
      return { ref: db, url: withDb(db) };
    },
    async destroy(ref) {
      if (!/^org_[0-9a-f]{16}$/.test(ref)) throw new Error("Not a database reference.");
      await admin((c) => c.query(`drop database if exists "${ref}" with (force)`));
    },
  };
}

/** Chosen by ORG_DB_PROVIDER ("neon" or "local"). */
export function providerFromEnv(): DbProvider {
  const kind = process.env.ORG_DB_PROVIDER;
  if (kind === "neon") {
    const apiKey = process.env.NEON_API_KEY;
    if (!apiKey) throw new Error("NEON_API_KEY is not set.");
    return neonProvider({ apiKey, region: process.env.NEON_REGION });
  }
  if (kind === "local") {
    const url = process.env.LOCAL_DB_ADMIN_URL ?? process.env.DATABASE_URL;
    if (!url) throw new Error("LOCAL_DB_ADMIN_URL is not set.");
    return localProvider(url);
  }
  throw new Error("ORG_DB_PROVIDER must be \"neon\" or \"local\".");
}
