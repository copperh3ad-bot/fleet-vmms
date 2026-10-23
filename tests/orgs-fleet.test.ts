// Keeping many databases up to date (ADR-014): one organization failing never blocks or half-changes the others.
import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { secretBox } from "@/lib/crypto/secretbox";
import { advanceProvisioning, startOrganization, type ProvisionDeps } from "@/lib/orgs/provision";
import { driftDedicated, migrateDedicated, type FleetDeps } from "@/lib/orgs/fleet";
import { findDrift, migrateAllTenants, type Migration } from "@/lib/db/migrate";
import { farm, newControl, platformMigrations, stripExt, tenantMigrations } from "./helpers";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const box = secretBox(randomBytes(32));

let control: Awaited<ReturnType<typeof newControl>>;
let f: ReturnType<typeof farm>;
let fleet: FleetDeps;
const urls: string[] = [];

beforeAll(async () => {
  control = await newControl();
  f = farm();
  const d: ProvisionDeps = { control, provider: f.provider(), openDb: f.open, box, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(), transform: stripExt, connectRetries: { tries: 1, delayMs: 1 } };
  for (let i = 1; i <= 3; i++) {
    const { tenantId } = await startOrganization(d, { name: `Fleet ${i}`, slug: `fleet-${i}`, ownerUserId: U(i), ownerName: `Owner ${i}`, ownerEmail: `o${i}@example.com` });
    await advanceProvisioning(d, tenantId);
  }
  urls.push(...f.dbs.keys());
  fleet = { control, openDb: f.open, box, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(), transform: stripExt, concurrency: 2 };
});

const extra = (n: number, sql: string): Migration => ({ name: `${n}_extra.sql`, sql, checksum: `c${n}` });
const marker = (db: ReturnType<typeof farm>["dbs"] extends Map<string, infer V> ? V : never, schema: string) => db.transaction(async (q) => (await q.query(`select 1 from information_schema.tables where table_schema = $1 and table_name = 'fleet_marker'`, [schema])).rows.length);

describe("migrating every organization's database", () => {
  it("reports no drift when everything matches, then applies a new migration to all of them", async () => {
    expect(await driftDedicated(fleet)).toEqual([]);
    expect((await migrateDedicated(fleet)).every((r) => r.applied.length === 0 && !r.error)).toBe(true);

    const next = [...tenantMigrations(), extra(9001, "create table if not exists fleet_marker(id int);")];
    const withNext: FleetDeps = { ...fleet, tenantMigrations: next };
    expect((await driftDedicated(withNext)).map((d) => d.slug).sort()).toEqual(["fleet-1", "fleet-2", "fleet-3"]);
    const res = await migrateDedicated(withNext);
    expect(res.map((r) => r.applied)).toEqual([["9001_extra.sql"], ["9001_extra.sql"], ["9001_extra.sql"]]);
    expect(await driftDedicated(withNext)).toEqual([]);
    const schemas = res.map((r) => r.schema);
    for (let i = 0; i < 3; i++) expect(await marker(f.dbs.get(urls[i])!, schemas[i])).toBe(1);
    // running again changes nothing
    expect((await migrateDedicated(withNext)).every((r) => r.applied.length === 0)).toBe(true);
  });

  it("one broken organization is reported and does not stop or half-change the others", async () => {
    const bad = [...tenantMigrations(), extra(9001, "create table if not exists fleet_marker(id int);"), extra(9002, "create table fleet_two(id int); select definitely_not_a_function();")];
    const res = await migrateDedicated({ ...fleet, tenantMigrations: bad });
    expect(res.every((r) => r.error && /definitely_not_a_function/.test(r.error))).toBe(true);        // the same bad SQL fails everywhere here...
    // ...and rolled back everywhere: no half-applied table
    const schemas = res.map((r) => r.schema);
    for (let i = 0; i < 3; i++) {
      const has = await f.dbs.get(urls[i])!.transaction(async (q) => (await q.query(`select 1 from information_schema.tables where table_schema = $1 and table_name = 'fleet_two'`, [schemas[i]])).rows.length);
      expect(has).toBe(0);
    }
    // an organization whose database is gone is reported as unreachable while the rest are checked
    const gone: FleetDeps = { ...fleet, openDb: (u) => { if (u === urls[1]) throw new Error(`connect refused ${u}`); return f.open(u); } };
    const drift = await driftDedicated({ ...gone, tenantMigrations: [...tenantMigrations(), extra(9001, "create table if not exists fleet_marker(id int);")] });
    expect(drift).toHaveLength(1);
    expect(drift[0].slug).toBe("fleet-2");
    expect(drift[0].reason).toMatch(/unreachable/);
    expect(drift[0].reason).not.toContain("postgresql://");
  });

  it("with one database unreachable, that one is reported and the others still migrate", async () => {
    const three = [...tenantMigrations(), extra(9001, "create table if not exists fleet_marker(id int);"), extra(9003, "create table if not exists fleet_three(id int);")];
    const res = await migrateDedicated({ ...fleet, tenantMigrations: three, openDb: (u) => { if (u === urls[1]) throw new Error(`connect refused ${u}`); return f.open(u); } });
    expect(res.map((r) => [r.slug, r.applied, !!r.error])).toEqual([["fleet-1", ["9003_extra.sql"], false], ["fleet-2", [], true], ["fleet-3", ["9003_extra.sql"], false]]);
    expect(res[1].error).toMatch(/connect refused \[connection\]/);
    expect((await migrateDedicated({ ...fleet, tenantMigrations: three })).map((r) => r.applied)).toEqual([[], ["9003_extra.sql"], []]);   // the next run catches the one that was down up
  });

  it("organizations that never went live or were closed are skipped, and the shared helpers ignore dedicated ones", async () => {
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.tenants set status = 'closed' where slug = 'fleet-3'"); });
    expect((await migrateDedicated({ ...fleet, tenantMigrations: [...tenantMigrations(), extra(9001, "create table if not exists fleet_marker(id int);"), extra(9003, "create table if not exists fleet_three(id int);")] })).map((r) => r.slug)).toEqual(["fleet-1", "fleet-2"]);
    expect(await findDrift(control, tenantMigrations())).toEqual([]);                                  // the control database has no shared organization here
    expect(await migrateAllTenants(control, tenantMigrations(), { transform: stripExt })).toEqual([]);
  });
});
