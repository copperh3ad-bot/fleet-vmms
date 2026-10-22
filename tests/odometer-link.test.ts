import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withLinkContext, withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as od from "@/lib/odometer/service";
import { LINK_HOURS, hashToken, lookupLink, submitViaLink } from "@/lib/odometer/link";
import { allow, resetRateLimits } from "@/lib/rate-limit";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 12);

let veh1: string, veh2: string;
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);
const odo = (v: string) => raw(async (q) => (await q.query<{ odometer_km: string }>("select odometer_km::text from vehicles where id = $1", [v])).rows[0].odometer_km);
const subOf = (cycle: string, vehicle: string) => raw(async (q) => (await q.query<{ id: string; status: string; reading_km: string | null; submitted_by: string | null }>(
  "select id, status, reading_km::text, submitted_by::text from odometer_submissions where cycle_id = $1 and vehicle_id = $2", [cycle, vehicle])).rows[0]);
let month = 0;
/** A fresh open cycle with a link for each vehicle. */
async function freshCycle() {
  month += 1;
  const period = `${2030 + Math.floor((month - 1) / 12)}-${String(((month - 1) % 12) + 1).padStart(2, "0")}`;
  const cycle = await od.openCycle(d, mgr(), period, `${period}-25`);
  const links = await od.createLinks(d, mgr(), cycle);
  return { cycle, links, tokenOf: (plate: string) => links.find((l) => l.plate === plate)!.token };
}

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  const e = await master.saveEmployee(d, owner(), { full_name: "Driver One", employee_no: "E-1", phone: "+92 300 1234567" });
  veh1 = (await master.addVehicle(d, owner(), { registration_no: "BKL-245", odometer_km: "1000", employee_id: e.id, holding_since: "2026-01-01" })).id;
  veh2 = (await master.addVehicle(d, owner(), { registration_no: "BKL-300", odometer_km: "5000" })).id;
});
beforeEach(() => resetRateLimits());

describe("creating links", () => {
  it("opens a cycle with one row per active vehicle, one cycle per month", async () => {
    const { cycle } = await freshCycle();
    const detail = (await od.getCycle(d, mgr(), cycle))!;
    expect(detail.rows.map((r) => r.registration_no).sort()).toEqual(["BKL-245", "BKL-300"]);
    await expect(od.openCycle(d, mgr(), "2030-01", "2030-01-25")).rejects.toThrow(/already exists/);
  });

  it("makes a long random token per vehicle and stores only its hash", async () => {
    const { links } = await freshCycle();
    expect(links).toHaveLength(2);
    expect(new Set(links.map((l) => l.token)).size).toBe(2);
    for (const l of links) {
      expect(l.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      const rows = await withPlatform(d, async (q) => (await q.query<Record<string, unknown>>("select * from public.odometer_links where token_hash = $1", [hashToken(l.token)])).rows);
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows[0])).not.toContain(l.token);                    // the token itself is nowhere in the row
      const hours = (new Date(l.expires_at as string).getTime() - Date.now()) / 3.6e6;
      expect(hours).toBeGreaterThan(LINK_HOURS - 1);
      expect(hours).toBeLessThanOrEqual(LINK_HOURS + 0.1);
    }
    expect(links.find((l) => l.plate === "BKL-245")).toMatchObject({ holder_name: "Driver One", holder_phone: "+92 300 1234567" });
  });

  it("a new link replaces the old one", async () => {
    const { cycle, links } = await freshCycle();
    const old = links[0];
    const again = await od.createLinks(d, mgr(), cycle, [old.submission_id]);
    expect(await lookupLink(d, old.token)).toBeNull();
    expect(await lookupLink(d, again[0].token)).not.toBeNull();
  });

  it("an admin can revoke, and entering the reading by hand ends the link", async () => {
    const { cycle, links } = await freshCycle();
    await od.revokeLinks(d, mgr(), links[0].submission_id);
    expect(await lookupLink(d, links[0].token)).toBeNull();
    await od.enterReading(d, mgr(), links[1].submission_id, "5100");
    expect(await lookupLink(d, links[1].token)).toBeNull();
    expect((await subOf(cycle, veh2)).status === "submitted" || (await subOf(cycle, veh1)).status === "submitted").toBe(true);
  });
});

describe("using a link", () => {
  it("shows only the plate and month", async () => {
    const { tokenOf } = await freshCycle();
    const view = await lookupLink(d, tokenOf("BKL-245"));
    expect(Object.keys(view!).sort()).toEqual(["due_on", "period", "plate"]);
    expect(view!.plate).toBe("BKL-245");
  });

  it("saves the reading for review, once, without moving the odometer", async () => {
    const { cycle, tokenOf } = await freshCycle();
    const tok = tokenOf("BKL-245");
    expect(await submitViaLink(d, tok, "1,250.5")).toBe("ok");
    const s = await subOf(cycle, veh1);
    expect(s).toMatchObject({ status: "submitted", reading_km: "1250.5", submitted_by: null });
    expect(await odo(veh1)).toBe("1000.0");                         // not moved until an admin approves
    expect(await submitViaLink(d, tok, "9999")).toBe("invalid");    // single use
    expect(await lookupLink(d, tok)).toBeNull();
    expect((await subOf(cycle, veh1)).reading_km).toBe("1250.5");   // second try changed nothing

    await od.reviewReading(d, mgr(), s.id, "approve");
    expect(await odo(veh1)).toBe("1250.5");
  });

  it("rejects typos without using up the link", async () => {
    const { tokenOf } = await freshCycle();
    const tok = tokenOf("BKL-300");
    for (const bad of ["", "abc", "-5", "12.55", "1e5", "12345678", "1 2", "0x10"]) expect(await submitViaLink(d, tok, bad)).toBe("bad_value");
    expect(await lookupLink(d, tok)).not.toBeNull();
    expect(await submitViaLink(d, tok, "5200")).toBe("ok");
  });

  it("an implausible reading still needs an admin note to be accepted", async () => {
    const { cycle, tokenOf } = await freshCycle();
    await submitViaLink(d, tokenOf("BKL-300"), "900000");
    const s = await subOf(cycle, veh2);
    await expect(od.reviewReading(d, mgr(), s.id, "approve")).rejects.toThrow(UserError);
    expect(await odo(veh2)).not.toBe("900000.0");
    await od.reviewReading(d, mgr(), s.id, "approve", "Confirmed with the driver, tank was replaced");
  });

  it("a rejected reading can be answered again with a new link", async () => {
    const { cycle, tokenOf } = await freshCycle();
    await submitViaLink(d, tokenOf("BKL-245"), "1");
    const s = await subOf(cycle, veh1);
    await expect(od.reviewReading(d, mgr(), s.id, "reject", "no")).rejects.toThrow(/at least 5/);
    await od.reviewReading(d, mgr(), s.id, "reject", "Reading looks too low");
    const fresh = await od.createLinks(d, mgr(), cycle, [s.id]);
    expect(await submitViaLink(d, fresh[0].token, "1300")).toBe("ok");
  });
});

describe("links that do not work all look the same", () => {
  it("unknown, malformed, expired, revoked and closed-cycle links give no answer", async () => {
    const { cycle, tokenOf } = await freshCycle();
    for (const tok of ["", "x", "A".repeat(43), "A".repeat(44), "../../etc/passwd", "a b"]) {
      expect(await lookupLink(d, tok)).toBeNull();
      expect(await submitViaLink(d, tok, "100")).toBe("invalid");
    }
    // expired
    const expired = tokenOf("BKL-245");
    await withPlatform(d, (q) => q.query("update public.odometer_links set expires_at = now() - interval '1 minute' where token_hash = $1", [hashToken(expired)]));
    expect(await lookupLink(d, expired)).toBeNull();
    expect(await submitViaLink(d, expired, "1200")).toBe("invalid");
    // cycle closed behind the link's back: the reading is refused and the link is not burned
    const other = tokenOf("BKL-300");
    await raw((q) => q.query("update odometer_cycles set status = 'closed' where id = $1", [cycle]));
    expect(await lookupLink(d, other)).toBeNull();
    expect(await submitViaLink(d, other, "5300")).toBe("invalid");
    const used = await withPlatform(d, async (q) => (await q.query<{ used_at: string | null }>("select used_at::text from public.odometer_links where token_hash = $1", [hashToken(other)])).rows[0].used_at);
    expect(used).toBeNull();
  });

  it("closing a cycle revokes its links", async () => {
    const { cycle, tokenOf } = await freshCycle();
    const tok = tokenOf("BKL-245");
    await od.closeCycle(d, mgr(), cycle);
    expect(await lookupLink(d, tok)).toBeNull();
    await expect(od.createLinks(d, mgr(), cycle)).rejects.toThrow(/closed/);
    await expect(od.closeCycle(d, mgr(), cycle)).rejects.toThrow(/already closed/);
  });

  it("a suspended workspace's links stop working", async () => {
    const { tokenOf } = await freshCycle();
    const tok = tokenOf("BKL-245");
    await withPlatform(d, (q) => q.query("update public.tenants set status = 'suspended' where id = $1", [t.tenantId]));
    expect(await lookupLink(d, tok)).toBeNull();
    expect(await submitViaLink(d, tok, "1400")).toBe("invalid");
    await withPlatform(d, (q) => q.query("update public.tenants set status = 'active' where id = $1", [t.tenantId]));
    expect(await lookupLink(d, tok)).not.toBeNull();
  });
});

describe("what the link context can do", () => {
  it("runs as a database role that can do nothing except call the two link functions", async () => {
    await withLinkContext(d, t.schema, async (q) => {
      expect((await q.query<{ u: string; r: string; db: string }>("select current_setting('app.user_id') u, current_setting('app.role') r, current_user db")).rows[0]).toEqual({ u: "", r: "odometer_link", db: "odometer_link" });
    });
    const denied = (sql: string) => withLinkContext(d, t.schema, (q) => q.query(sql)).then(() => "allowed", (e: Error) => (/permission denied/.test(e.message) ? "denied" : `other: ${e.message}`));
    for (const sql of [
      "select * from vehicles", "select * from employees", "select * from job_cards", "select * from odometer_submissions", "select * from odometer_readings",
      "select * from role_permissions", "select * from audit_log", "select * from public.tenants", "select * from public.tenant_memberships",
      "select * from public.odometer_links", "update odometer_submissions set status = 'approved'", "update vehicles set odometer_km = 1",
      "insert into odometer_readings(vehicle_id, reading_km, source) values (gen_random_uuid(), 1, 'manual')",
      "delete from audit_log", "select submit_odometer(gen_random_uuid(), 1, null, null)", "select approve_odometer_submission(gen_random_uuid(), gen_random_uuid(), null)",
      "select transition_job_card(gen_random_uuid(), 'approved', gen_random_uuid())", "select open_odometer_cycle(current_date, current_date)",
      "update public.odometer_links set used_at = now()", "select public.rate_limit_hit('x', 1, 1)",
    ]) expect(await denied(sql), sql).toBe("denied");
  });
  it("can still call exactly the two link functions", async () => {
    await withLinkContext(d, t.schema, async (q) => {
      expect((await q.query("select * from link_submission_info(gen_random_uuid())")).rows).toEqual([]);
      await expect(q.query("select submit_odometer_via_link(gen_random_uuid(), 1, 'nope')")).rejects.toThrow(/link is not valid/);
    });
  });
  it("cannot reach other workspaces' schemas", async () => {
    // Known limit (ADR-006): a role switch is checked against the connection's login user, so code that could run
    // arbitrary SQL here could switch back. The role protects against mistakes in the two small files that use it;
    // those only run fixed, parameterised statements. A separate login for the link route would be a real wall.
    const other = await provisionTenant(d, { name: "Other Link Co", slug: "other-link", ownerUserId: U(9), ownerName: "O" }, tenantMigrations(), { transform: stripExt });
    const denied = await withLinkContext(d, t.schema, (q) => q.query(`select * from "${other.schema}".vehicles`)).then(() => "allowed", (e: Error) => /permission denied/.test(e.message) ? "denied" : e.message);
    expect(denied).toBe("denied");
  });
  it("cannot be pointed at a name that is not a tenant schema", async () => {
    await expect(withLinkContext(d, "public", async () => 1)).rejects.toThrow(/invalid tenant schema/);
    await expect(withLinkContext(d, 'tenant_x"; drop schema public; --', async () => 1)).rejects.toThrow(/invalid tenant schema/);
  });
});

describe("admin side permissions", () => {
  it("only odometer.review may open cycles and make links", async () => {
    const cycle = (await freshCycle()).cycle;
    for (const role of ["requester", "finance", "auditor", "vendor"]) {
      const m = mem(role, 40);
      await expect(od.listCycles(d, m)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(od.createLinks(d, m, cycle)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(od.openCycle(d, m, "2040-01", "2040-01-25")).rejects.toBeInstanceOf(ForbiddenError);
      await expect(od.reviewReading(d, m, cycle, "approve")).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await od.listCycles(d, owner())).length).toBeGreaterThan(0);          // tenant_admin has odometer.review
  });
});

describe("rate limiter", () => {
  it("allows up to the limit inside the window, then refuses, then recovers", () => {
    expect([1, 2, 3].map(() => allow("k", 3, 1000, 0))).toEqual([true, true, true]);
    expect(allow("k", 3, 1000, 10)).toBe(false);
    expect(allow("other", 3, 1000, 10)).toBe(true);
    expect(allow("k", 3, 1000, 1500)).toBe(true);
  });
});
