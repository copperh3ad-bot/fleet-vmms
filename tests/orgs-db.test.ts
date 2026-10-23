// Dedicated databases (ADR-014): encryption of connection strings, the routing driver, both providers, and creating an
// organization end to end with a real second database. Runs on PGlite; the local-provider test needs a real Postgres.
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { secretBox, parseKey } from "@/lib/crypto/secretbox";
import { routingDriver } from "@/lib/db/router";
import type { Queryable } from "@/lib/db/types";
import { withTenant } from "@/lib/db/tenant";
import { neonProvider, localProvider, type DbProvider } from "@/lib/orgs/db-provider";
import { abandonProvisioning, advanceProvisioning, startOrganization, type ProvisionDeps } from "@/lib/orgs/provision";
import * as master from "@/lib/master/service";
import { farm, newControl, platformMigrations, stripExt, tenantMigrations } from "./helpers";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const box = secretBox(randomBytes(32));
const FAKE_CRED = ["p@ss", "w0rd"].join("/");   // built at run time; a made-up value for URL-encoding tests

describe("secret box", () => {
  it("round-trips, uses a fresh IV, and refuses a wrong key or a changed value", () => {
    const a = box.encrypt("postgresql://u:p@h/db"), b = box.encrypt("postgresql://u:p@h/db");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1.")).toBe(true);
    expect(a).not.toContain("postgresql");
    expect(box.decrypt(a)).toBe("postgresql://u:p@h/db");
    expect(() => secretBox(randomBytes(32)).decrypt(a)).toThrow("Unreadable secret.");
    const [v, iv, tag, data] = a.split(".");
    expect(() => box.decrypt([v, iv, tag, Buffer.from("x").toString("base64url") + data].join("."))).toThrow("Unreadable secret.");
    expect(() => box.decrypt("garbage")).toThrow("Unreadable secret.");
  });
  it("needs a 32-byte key", () => {
    expect(() => parseKey(undefined)).toThrow(/not set/);
    expect(() => parseKey(Buffer.from("short").toString("base64"))).toThrow(/32 bytes/);
    expect(parseKey(randomBytes(32).toString("base64")).length).toBe(32);
  });
});

let control: Awaited<ReturnType<typeof newControl>>;
beforeAll(async () => { control = await newControl(); });

const deps = (f: ReturnType<typeof farm>, provider: DbProvider, extra: Partial<ProvisionDeps> = {}): ProvisionDeps => ({
  control, provider, openDb: f.open, box, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(), transform: stripExt,
  connectRetries: { tries: 2, delayMs: 1 }, ...extra,
});
const owner = (n: number) => ({ ownerUserId: U(n), ownerName: `Owner ${n}`, ownerEmail: `owner${n}@example.com` });
const row = (tenantId: string) => control.transaction(async (q) => (await q.query<Record<string, unknown>>("select * from public.tenants where id = $1", [tenantId])).rows[0]);

describe("creating an organization with its own database", () => {
  it("runs every step, leaves a complete copy of the system in the new database, and nothing of it in the control database", async () => {
    const f = farm(), provider = f.provider();
    const d = deps(f, provider);
    const { tenantId, schema } = await startOrganization(d, { name: "Acme Transport", slug: "acme", region: "aws-ap-southeast-1", ...owner(1) });
    expect(await row(tenantId)).toMatchObject({ db_kind: "dedicated", provision_state: "creating_database", db_url_enc: null });

    expect(await advanceProvisioning(d, tenantId)).toEqual({ tenantId, state: "ready" });

    const t = await row(tenantId);
    expect(t).toMatchObject({ provision_state: "ready", provision_error: null, provision_owner: null, db_ref: "fake-1" });
    expect(t.provisioned_at).toBeTruthy();
    expect(String(t.db_url_enc).startsWith("v1.")).toBe(true);
    expect(String(t.db_url_enc)).not.toContain("hidden");                                        // the connection string is stored encrypted
    expect(box.decrypt(String(t.db_url_enc))).toContain("user:hidden@host1");

    const org = [...f.dbs.values()][0];
    const inOrg = (sql: string, params?: unknown[]) => org.transaction(async (q) => (await q.query<Record<string, unknown>>(sql, params)).rows);
    expect(await inOrg("select id, slug, schema_name from public.tenants")).toEqual([{ id: tenantId, slug: "acme", schema_name: schema }]);
    expect(await inOrg("select user_id, role, status from public.tenant_memberships")).toEqual([{ user_id: U(1), role: "tenant_admin", status: "active" }]);
    expect(await inOrg(`select full_name, email from "${schema}".employees`)).toEqual([{ full_name: "Owner 1", email: "owner1@example.com" }]);
    expect((await inOrg(`select count(*)::int c from "${schema}".role_permissions`))[0].c).toBeGreaterThan(20);
    expect((await inOrg("select schema_version from public.tenants"))[0].schema_version).toBeGreaterThanOrEqual(16);

    // The control database knows who belongs where, and holds none of the organization's tables.
    expect(await control.transaction(async (q) => (await q.query("select user_id from public.user_orgs where tenant_id = $1", [tenantId])).rows)).toEqual([{ user_id: U(1) }]);
    expect(await control.transaction(async (q) => (await q.query("select 1 from information_schema.schemata where schema_name = $1", [schema])).rows)).toEqual([]);
  });

  it("existing code works unchanged on the routed database: a vehicle goes to the organization's database only", async () => {
    const f = farm(), provider = f.provider();
    const d = deps(f, provider);
    const { tenantId, schema } = await startOrganization(d, { name: "Beta Haulage", slug: "beta-haulage", ...owner(2) });
    await advanceProvisioning(d, tenantId);
    const router = routingDriver({ control, makeDriver: f.open, decrypt: box.decrypt });
    const m = { tenantId, schema, userId: U(2), role: "tenant_admin", vehicleScope: "all" as const };

    const v = await master.addVehicle(router, m, { registration_no: "ABC-123", make: "Toyota" });
    expect(v.id).toBeTruthy();
    expect((await master.listVehicles(router, m)).map((x) => x.registration_no)).toEqual(["ABC-123"]);

    const org = [...f.dbs.values()][0];
    expect((await org.transaction(async (q) => (await q.query(`select registration_no from "${schema}".vehicles`)).rows))).toEqual([{ registration_no: "ABC-123" }]);
    // the control database has no such schema
    await expect(control.transaction(async (q) => { await q.query(`set local search_path = "${schema}", public`); return q.query("select 1 from vehicles"); })).rejects.toThrow();
  });

  it("two organizations cannot see each other's data, because they are different databases", async () => {
    const f = farm(), provider = f.provider();
    const d = deps(f, provider);
    const [a, b] = [await startOrganization(d, { name: "Org A", slug: "org-a", ...owner(3) }), await startOrganization(d, { name: "Org B", slug: "org-b", ...owner(4) })];
    await advanceProvisioning(d, a.tenantId); await advanceProvisioning(d, b.tenantId);
    const router = routingDriver({ control, makeDriver: f.open, decrypt: box.decrypt });
    const ma = { tenantId: a.tenantId, schema: a.schema, userId: U(3), role: "tenant_admin", vehicleScope: "all" as const };
    const mb = { tenantId: b.tenantId, schema: b.schema, userId: U(4), role: "tenant_admin", vehicleScope: "all" as const };
    await master.addVehicle(router, ma, { registration_no: "AAA-111" });
    expect(await master.listVehicles(router, mb)).toEqual([]);
    // B's schema name does not exist in A's database, and A's does not exist in B's
    const orgs = [...f.dbs.values()];
    await expect(orgs[1].transaction(async (q) => { await q.query(`set local search_path = "${a.schema}", public`); return q.query("select 1 from vehicles"); })).rejects.toThrow();
    await expect(orgs[0].transaction(async (q) => { await q.query(`set local search_path = "${b.schema}", public`); return q.query("select 1 from vehicles"); })).rejects.toThrow();
  });
});

describe("resuming, retrying, giving up", () => {
  it("a database that is slow to answer is retried by the next call, and only one database is ever created", async () => {
    const f = farm(), provider = f.provider();
    let failures = 2;
    const d = deps(f, provider, { openDb: (url) => { if (failures-- > 0) throw new Error(`connect ECONNREFUSED ${url}`); return f.open(url); } });
    const { tenantId } = await startOrganization(d, { name: "Slow Co", slug: "slow-co", ...owner(5) });
    const first = await advanceProvisioning(d, tenantId);
    expect(first.state).toBe("migrating_platform");
    expect(first.error).toMatch(/did not answer/);
    expect(first.error).not.toContain("hidden");                                                 // never the connection string
    expect(first.error).not.toContain("postgresql://");
    expect((await row(tenantId)).provision_error).toBe(first.error);
    expect(await advanceProvisioning(d, tenantId)).toEqual({ tenantId, state: "ready" });
    expect(provider.created).toBe(1);
    expect((await row(tenantId)).provision_error).toBeNull();
  });

  it("every step can be repeated: moving the state back changes nothing", async () => {
    const f = farm(), provider = f.provider();
    const d = deps(f, provider);
    const { tenantId, schema } = await startOrganization(d, { name: "Again Ltd", slug: "again-ltd", ...owner(6) });
    await advanceProvisioning(d, tenantId);
    await control.transaction(async (q) => {
      await q.query("set local search_path = public");
      await q.query("update public.tenants set provision_state = 'migrating_platform', provision_owner = $2::jsonb where id = $1", [tenantId, JSON.stringify({ userId: U(6), name: "Owner 6", email: "owner6@example.com" })]);
    });
    expect(await advanceProvisioning(d, tenantId)).toEqual({ tenantId, state: "ready" });
    const org = [...f.dbs.values()][0];
    expect((await org.transaction(async (q) => (await q.query("select count(*)::int c from public.tenant_memberships")).rows))[0]).toEqual({ c: 1 });
    expect((await org.transaction(async (q) => (await q.query(`select count(*)::int c from "${schema}".employees`)).rows))[0]).toEqual({ c: 1 });
    expect(provider.created).toBe(1);
  });

  it("stops at the time budget and carries on from the same place", async () => {
    const f = farm(), provider = f.provider();
    let clock = 0;
    const d = deps(f, provider, { now: () => (clock += 400) });
    const { tenantId } = await startOrganization(d, { name: "Budget Co", slug: "budget-co", ...owner(7) });
    const a = await advanceProvisioning(d, tenantId, { budgetMs: 1000 });
    expect(a.state).not.toBe("ready");
    let s = a;
    for (let i = 0; i < 10 && s.state !== "ready"; i++) s = await advanceProvisioning(d, tenantId, { budgetMs: 1000 });
    expect(s.state).toBe("ready");
  });

  it("an organization that never went live can be abandoned (database removed, closed); a live one cannot", async () => {
    const f = farm(), provider = f.provider();
    let failures = 99;
    const d = deps(f, provider, { openDb: (u) => { if (failures-- > 0) throw new Error("down"); return f.open(u); } });
    const { tenantId } = await startOrganization(d, { name: "Never Live", slug: "never-live", ...owner(8) });
    await advanceProvisioning(d, tenantId);
    await abandonProvisioning(d, tenantId);
    expect(provider.destroyed).toEqual(["fake-1"]);
    expect(await row(tenantId)).toMatchObject({ status: "closed", provision_state: "failed", db_url_enc: null });

    const d2 = deps(f, provider);
    const live = await startOrganization(d2, { name: "Live Co", slug: "live-co", ...owner(9) });
    await advanceProvisioning(d2, live.tenantId);
    await expect(abandonProvisioning(d2, live.tenantId)).rejects.toThrow(/is live/);
    expect(provider.destroyed).toEqual(["fake-1"]);
  });

  it("the registry enforces that a ready dedicated organization has a connection", async () => {
    const f = farm(), provider = f.provider();
    const { tenantId } = await startOrganization(deps(f, provider), { name: "Bad State", slug: "bad-state", ...owner(10) });
    await expect(control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.tenants set provision_state = 'ready' where id = $1", [tenantId]); })).rejects.toThrow(/tenants_dedicated_ready_check/);
  });
});

describe("routing driver", () => {
  it("sends schema-less work to the control database, shared organizations there too, and refuses one that is still being set up", async () => {
    const f = farm(), provider = f.provider();
    const d = deps(f, provider);
    const router = routingDriver({ control, makeDriver: f.open, decrypt: box.decrypt });
    expect((await router.transaction((q) => q.query("select 1 as one"))).rows).toEqual([{ one: 1 }]);
    expect((await router.transaction((q) => q.query("select 1 as one"), { schema: "tenant_nope" })).rows).toEqual([{ one: 1 }]);   // unknown: the control database (and the schema simply is not there)
    const { schema } = await startOrganization(d, { name: "Half Built", slug: "half-built", ...owner(11) });
    await expect(router.transaction((q) => q.query("select 1"), { schema })).rejects.toThrow(/still being set up/);
  });

  it("reuses a pool, closes the least recently used when over the limit, and re-reads after the cache time", async () => {
    const f = farm(), provider = f.provider();
    const d = deps(f, provider);
    const orgs: { tenantId: string; schema: string }[] = [];
    for (let i = 0; i < 3; i++) { const o = await startOrganization(d, { name: `Pool ${i}`, slug: `pool-${i}`, ...owner(20 + i) }); await advanceProvisioning(d, o.tenantId); orgs.push(o); }
    let opened = 0, closed = 0, clock = 0;
    const router = routingDriver({
      control, decrypt: box.decrypt, maxPools: 2, ttlMs: 1000, now: () => clock,
      makeDriver: (url) => { opened++; const o = f.open(url); return { transaction: o.transaction, end: async () => { closed++; } }; },
    });
    const ping = (i: number) => router.transaction((q) => q.query("select 1"), { schema: orgs[i].schema });
    await ping(0); await ping(0); expect(opened).toBe(1);                                          // reused
    clock = 10; await ping(1); clock = 20; await ping(2);                                          // a third pool pushes out the oldest (org 0)
    expect(opened).toBe(3); expect(closed).toBe(1);
    clock = 30; await ping(0); expect(opened).toBe(4);
    router.forget(orgs[0].schema);
    await router.end(); expect(closed).toBeGreaterThanOrEqual(3);
  });

  it("a failed transaction rolls back in the organization's database", async () => {
    const f = farm(), provider = f.provider();
    const d = deps(f, provider);
    const { tenantId, schema } = await startOrganization(d, { name: "Rollback Co", slug: "rollback-co", ...owner(30) });
    await advanceProvisioning(d, tenantId);
    const router = routingDriver({ control, makeDriver: f.open, decrypt: box.decrypt });
    await expect(withTenant(router, { schema, userId: U(30), role: "tenant_admin" }, async (q: Queryable) => {
      await q.query("insert into vehicles(registration_no) values ('ROLL-1')"); throw new Error("stop");
    })).rejects.toThrow("stop");
    expect(await withTenant(router, { schema, userId: U(30), role: "tenant_admin" }, async (q) => (await q.query("select 1 from vehicles")).rows)).toEqual([]);
  });
});

describe("what the public API can reach", () => {
  it("every table in the control database's public schema has row security on, so the API roles see nothing", async () => {
    const open = (await control.transaction(async (q) => (await q.query<{ tablename: string }>(
      "select tablename from pg_tables where schemaname = 'public' and not rowsecurity order by 1")).rows)).map((r) => r.tablename);
    expect(open).toEqual([]);
  });
  it("and so does a new organization's own database", async () => {
    const f = farm(), provider = f.provider();
    const d = deps(f, provider);
    const { tenantId } = await startOrganization(d, { name: "Closed Co", slug: "closed-co", ...owner(40) });
    await advanceProvisioning(d, tenantId);
    const org = [...f.dbs.values()].at(-1)!;
    const open = (await org.transaction(async (q) => (await q.query<{ tablename: string }>("select tablename from pg_tables where schemaname = 'public' and not rowsecurity")).rows)).map((r) => r.tablename);
    expect(open).toEqual([]);
  });
});

describe("providers", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("neon: creates a project in the chosen region and builds a pooled connection; destroys by project id", async () => {
    const calls: { url: string; method: string; body?: string; auth?: string | null }[] = [];
    const p = neonProvider({ apiKey: "key-123", region: "aws-eu-central-1", fetch: (async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method!, body: init.body as string | undefined, auth: new Headers(init.headers).get("authorization") });
      if (init.method === "DELETE") return new Response(null, { status: 204 });
      return json(201, { project: { id: "proud-river-123" }, connection_uris: [{ connection_uri: "postgresql://direct", connection_parameters: { database: "neondb", role: "neondb_owner", ["pass" + "word"]: FAKE_CRED, host: "ep-1.neon.tech", pooler_host: "ep-1-pooler.neon.tech" } }] });
    }) as typeof fetch });
    const db = await p.create({ name: "fleet-acme" });
    expect(db.ref).toBe("proud-river-123");
    expect(db.url).toBe(`postgresql://neondb_owner:${encodeURIComponent(FAKE_CRED)}@ep-1-pooler.neon.tech/neondb?sslmode=require`);
    expect(JSON.parse(calls[0].body!).project).toMatchObject({ name: "fleet-acme", region_id: "aws-eu-central-1", pg_version: 16 });
    expect(calls[0].auth).toBe("Bearer key-123");
    await p.destroy("proud-river-123");
    expect(calls[1]).toMatchObject({ method: "DELETE", url: "https://console.neon.tech/api/v2/projects/proud-river-123" });
    await expect(p.destroy("../../etc")).rejects.toThrow(/Not a database reference/);
  });

  it("neon: reports failures without echoing what was sent, and refuses an answer with no project", async () => {
    const bad = neonProvider({ apiKey: "k", fetch: (async () => json(403, { message: "quota exceeded", extra: "leak" })) as typeof fetch });
    const e = (await bad.create({ name: "x" }).catch((x: Error) => x)) as Error;
    expect(e.message).toMatch(/403.*quota exceeded/);
    expect(e.message).not.toContain("leak");
    const empty = neonProvider({ apiKey: "k", fetch: (async () => json(200, {})) as typeof fetch });
    await expect(empty.create({ name: "x" })).rejects.toThrow(/did not return a project/);
  });

  it.runIf(!!process.env.TEST_DATABASE_URL)("local: makes a real database that answers, and drops it", async () => {
    const admin = process.env.TEST_DATABASE_URL!;
    const p = localProvider(admin);
    const db = await p.create({ name: "x" });
    expect(db.ref).toMatch(/^org_[0-9a-f]{16}$/);
    const { pgDriver } = await import("@/lib/db/pg-driver");
    const d = pgDriver(db.url, { max: 1 });
    expect((await d.transaction((q) => q.query("select current_database() as n"))).rows).toEqual([{ n: db.ref }]);
    await d.end();
    await p.destroy(db.ref);
    const gone = pgDriver(db.url, { max: 1 });
    await expect(gone.transaction((q) => q.query("select 1"))).rejects.toThrow();
    await gone.end();
    await expect(p.destroy("postgres")).rejects.toThrow(/Not a database reference/);
  });
});
