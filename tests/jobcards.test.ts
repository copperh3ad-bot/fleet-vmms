import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
let other: { tenantId: string; schema: string };
const mem = (role: string, n: number, tenant = t, vehicleScope: "all" | "own" = "all"): Membership => ({ ...tenant, userId: U(n), role, vehicleScope });

// 1 owner (tenant_admin), 11 driver (requester), 12 + 13 fleet managers, 14 finance, 15 auditor, 16 another requester
const owner = () => mem("tenant_admin", 1);
const driver = () => mem("requester", 11, t, "own");
const mgr = () => mem("fleet_manager", 12);
const mgr2 = () => mem("fleet_manager", 13);
const finance = () => mem("finance", 14);
const auditor = () => mem("auditor", 15);
const driver2 = () => mem("requester", 16, t, "own");

const emp: Record<number, string> = {};
let veh: string, veh2: string, reasonWear: string, reasonMisuse: string;

/** Runs fn as if the administrator were the only active member: everyone else is switched off for the duration, then switched back on (ADR-072). */
async function alone<T>(fn: () => Promise<T>): Promise<T> {
  const set = (status: string, from: string) => d.transaction(async (q) => { await q.query("set local search_path = public"); return (await q.query<{ user_id: string }>("update public.tenant_memberships set status = $1 where tenant_id = $2 and user_id <> $3 and status = $4 returning user_id", [status, t.tenantId, U(1), from])).rows; });
  const off = await set("disabled", "active");
  try { return await fn(); }
  finally { await d.transaction(async (q) => { await q.query("set local search_path = public"); for (const r of off) await q.query("update public.tenant_memberships set status = 'active' where tenant_id = $1 and user_id = $2", [t.tenantId, r.user_id]); }); }
}

const raw = <T,>(m: Membership, fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, m, fn);
const card = (over: Record<string, unknown> = {}) => ({
  vehicle_id: veh, reason_code_id: reasonWear, cause_text: "Front brake pads worn to the metal", category: "corrective", priority: "normal",
  lines: [{ kind: "part", description: "Brake pads", qty: "2", unit_cost: "1500" }, { kind: "labour", description: "Fit pads", qty: "1", unit_cost: "800" }],
  ...over,
});
const statusOf = (id: string) => raw(owner(), async (q) => (await q.query<{ status: string }>("select status from job_cards where id = $1", [id])).rows[0].status);
const events = (id: string) => raw(owner(), async (q) => (await q.query<{ from_status: string | null; to_status: string }>("select from_status, to_status from job_card_events where job_card_id = $1 order by seq", [id])).rows);
const submitted = async (m = driver()) => (await jc.createJobCard(d, m, card(), true)).id;

beforeAll(async () => {
  d = await testDriver();
  const m = tenantMigrations();
  const o = { transform: stripExt };
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, m, o);
  other = await provisionTenant(d, { name: "Other Co", slug: "other", ownerUserId: U(2), ownerName: "Other Owner" }, m, o);
  for (const [n, name] of [[11, "Driver One"], [12, "Manager One"], [13, "Manager Two"], [14, "Finance One"], [15, "Auditor One"], [16, "Driver Two"]] as const) {
    emp[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` })).id;
    await raw(owner(), (q) => q.query("update employees set user_id = $1 where id = $2", [U(n), emp[n]]));
  }
  // Notifications find approvers through the platform memberships table, so the people need real memberships.
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [13, "fleet_manager"], [14, "finance"], [15, "auditor"], [16, "requester"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  veh = (await master.addVehicle(d, owner(), { registration_no: "BKL-245", make: "Isuzu", odometer_km: "1000", employee_id: emp[11], holding_since: "2026-01-01" })).id;
  veh2 = (await master.addVehicle(d, owner(), { registration_no: "BKL-300", make: "Toyota", odometer_km: "500", employee_id: emp[16], holding_since: "2026-01-01" })).id;
  const rc = await raw(owner(), async (q) => (await q.query<{ id: string; code: string }>("select id, code from reason_codes")).rows);
  reasonWear = rc.find((r) => r.code === "WEAR_BRAKES")!.id;
  reasonMisuse = rc.find((r) => r.code === "MISUSE_OVERLOAD")!.id;
});

describe("creating", () => {
  it("saves a draft with lines, the custodian at that time, and a first event", async () => {
    const { id, job_no } = await jc.createJobCard(d, driver(), card(), false);
    expect(job_no).toMatch(/^JC-\d{6}$/);
    const c = (await jc.getJobCard(d, driver(), id))!;
    expect(c.status).toBe("draft");
    expect(c.custodian_name).toBe("Driver One");
    expect(c.requester_name).toBe("Driver One");
    expect(c.lines).toHaveLength(2);
    expect(c.estimated_cost).toBe("3800.00");
    expect(await events(id)).toEqual([{ from_status: null, to_status: "draft" }]);
  });

  it("submit-on-create writes both events and tells every approver except the requester", async () => {
    const id = await submitted();
    expect(await statusOf(id)).toBe("submitted");
    expect(await events(id)).toEqual([{ from_status: null, to_status: "draft" }, { from_status: "draft", to_status: "submitted" }]);
    expect((await jc.listNotifications(d, mgr())).some((n) => n.kind === "jobcard.submitted" && n.payload.job_card_id === id)).toBe(true);
    expect((await jc.listNotifications(d, mgr2())).some((n) => n.payload.job_card_id === id)).toBe(true);
    expect((await jc.listNotifications(d, driver())).some((n) => n.payload.job_card_id === id)).toBe(false);
  });

  it("rejects a short cause, a missing vehicle and a bad line, with field messages", async () => {
    const e = await jc.createJobCard(d, driver(), card({ cause_text: "bad", vehicle_id: "" }), false).catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    expect(Object.keys(e.fields)).toEqual(expect.arrayContaining(["cause_text", "vehicle_id"]));
    const e2 = await jc.createJobCard(d, driver(), card({ lines: [{ description: "x", qty: "0" }] }), false).catch((x) => x);
    expect(e2.fields["lines.0.qty"]).toBeTruthy();
  });

  it("a manager can raise a card on behalf of a driver", async () => {
    const { id } = await jc.createJobCard(d, mgr(), card({ requested_by: emp[11] }), true);
    const c = (await jc.getJobCard(d, mgr(), id))!;
    expect(c.requester_name).toBe("Driver One");
    expect(c.mine).toBe(true); // the manager opened it, so can still edit it
    expect(c.requester_is_me).toBe(false);
    // The rule is requester <> approver, so a manager who only entered it for the driver may approve it.
    await jc.transitionJobCard(d, mgr(), id, "approved");
    expect(await statusOf(id)).toBe("approved");
  });

  it("a user with no employee record cannot raise a card", async () => {
    const e = await jc.createJobCard(d, mem("fleet_manager", 40), card(), false).catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    expect(e.message).toMatch(/employee record/i);
  });

  it("a job card odometer becomes a reading and moves the vehicle", async () => {
    await jc.createJobCard(d, driver(), card({ odometer_km: "1250" }), false);
    const v = await raw(owner(), async (q) => (await q.query<{ odometer_km: string }>("select odometer_km::text from vehicles where id = $1", [veh])).rows[0]);
    expect(v.odometer_km).toBe("1250.0");
  });

  it("scope 'own' cannot raise a card for a vehicle someone else holds", async () => {
    const e = await jc.createJobCard(d, driver(), card({ vehicle_id: veh2 }), false).catch((x) => x);
    expect(e).toBeInstanceOf(ForbiddenError);
  });

  it("scope 'own' can raise for the vehicle they hold; an administrator can raise for any vehicle", async () => {
    await jc.createJobCard(d, driver(), card({ vehicle_id: veh }), false);
    for (const v of [veh, veh2]) expect((await jc.createJobCard(d, mem("tenant_admin", 1), card({ vehicle_id: v }), false)).job_no).toBeTruthy();
  });
});

describe("approval", () => {
  it("a manager approves, becomes the approver, keeps the requester's reason, and the requester is told", async () => {
    const id = await submitted();
    await jc.transitionJobCard(d, mgr(), id, "approved", { reasonCodeId: reasonMisuse });
    const c = (await jc.getJobCard(d, mgr(), id))!;
    expect(c.status).toBe("approved");
    expect(c.approver_name).toBe("Manager One");
    expect(c.reason_label).toMatch(/overload/i);
    expect(c.requested_reason_label).toMatch(/brake/i);
    expect((await events(id)).at(-1)).toEqual({ from_status: "submitted", to_status: "approved" });
    expect((await jc.listNotifications(d, driver())).some((n) => n.kind === "jobcard.approved" && n.payload.job_card_id === id)).toBe(true);
  });

  it("self-approval fails through the service", async () => {
    const { id } = await jc.createJobCard(d, mgr(), card(), true);
    const e = await jc.transitionJobCard(d, mgr(), id, "approved").catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    expect(e.message).toMatch(/segregation/i);
    expect(await statusOf(id)).toBe("submitted");
  });

  it("self-approval fails at the database even when the SQL is written by hand", async () => {
    const { id } = await jc.createJobCard(d, mgr(), card(), true);
    // same person as requester
    await expect(raw(mgr(), (q) => q.query("update job_cards set status = 'approved', approved_by = $2 where id = $1", [id, emp[12]]))).rejects.toThrow(/segregation/i);
    // naming someone else as approver while signed in as the requester
    await expect(raw(mgr(), (q) => q.query("update job_cards set status = 'approved', approved_by = $2 where id = $1", [id, emp[13]]))).rejects.toThrow(/signed-in user/i);
    // no approver at all
    await expect(raw(mgr2(), (q) => q.query("update job_cards set status = 'approved' where id = $1", [id]))).rejects.toThrow(/needs an approver/i);
    expect(await statusOf(id)).toBe("submitted");
  });

  it("the administrator cannot approve a job card they raised once someone else could (ADR-072)", async () => {
    const { id } = await jc.createJobCard(d, owner(), card(), true);
    await expect(jc.transitionJobCard(d, owner(), id, "approved")).rejects.toThrow(/segregation/i);
    expect(await statusOf(id)).toBe("submitted");
    await jc.transitionJobCard(d, mgr(), id, "approved");              // a manager can, as always
    expect(await statusOf(id)).toBe("approved");
  });

  it("the administrator may approve a job card they raised themselves while nobody else could, and it is recorded", async () => {
    const { id } = await jc.createJobCard(d, owner(), card(), true);
    await alone(() => jc.transitionJobCard(d, owner(), id, "approved"));
    expect(await statusOf(id)).toBe("approved");
    const c = (await jc.getJobCard(d, owner(), id))!;
    expect(c.approver_name).toBeTruthy();
    expect((await events(id)).at(-1)).toEqual({ from_status: "submitted", to_status: "approved" });
    // the exception is for the administrator only: a manager still cannot approve their own card
    const mine = await jc.createJobCard(d, mgr(), card(), true);
    await expect(jc.transitionJobCard(d, mgr(), mine.id, "approved")).rejects.toThrow(/segregation/i);
  });

  it("a role without jobcard.approve cannot approve even by hand", async () => {
    const id = await submitted();
    await expect(raw(finance(), (q) => q.query("update job_cards set status = 'approved', approved_by = $2 where id = $1", [id, emp[14]]))).rejects.toThrow(/may not approve/i);
  });

  it("the approver cannot be changed afterwards", async () => {
    const id = await submitted();
    await jc.transitionJobCard(d, mgr(), id, "approved");
    await expect(raw(mgr2(), (q) => q.query("update job_cards set approved_by = $2 where id = $1", [id, emp[13]]))).rejects.toThrow(/approver can only be set/i);
  });

  it("reject and return need a real comment", async () => {
    const id = await submitted();
    const e = await jc.transitionJobCard(d, mgr(), id, "rejected", { comment: "no" }).catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    await jc.transitionJobCard(d, mgr(), id, "rejected", { comment: "Not a company vehicle repair" });
    expect(await statusOf(id)).toBe("rejected");
    // rejected is final
    await expect(jc.transitionJobCard(d, mgr(), id, "approved")).rejects.toThrow(/illegal job card transition/i);
  });
});

describe("state machine and events", () => {
  it("refuses illegal jumps", async () => {
    const draft = (await jc.createJobCard(d, driver(), card(), false)).id;
    await expect(raw(mgr(), (q) => q.query("update job_cards set status = 'in_progress' where id = $1", [draft]))).rejects.toThrow(/illegal job card transition/i);
    const e = await jc.transitionJobCard(d, mgr(), draft, "approved").catch((x) => x);
    expect(e.message).toMatch(/illegal job card transition draft -> approved/i);
  });

  it("a status change without an event cannot commit", async () => {
    const draft = (await jc.createJobCard(d, driver(), card(), false)).id;
    await expect(raw(driver(), (q) => q.query("update job_cards set status = 'submitted' where id = $1", [draft]))).rejects.toThrow(/without a job_card_events row/i);
    expect(await statusOf(draft)).toBe("draft");
  });

  it("a card inserted by hand without an event cannot commit, and must start as a draft", async () => {
    const ins = (status: string) => raw(owner(), (q) => q.query(
      "insert into job_cards(vehicle_id, requested_by, reason_code_id, cause_text, status) values ($1, $2, $3, 'long enough cause', $4)", [veh, emp[11], reasonWear, status]));
    await expect(ins("draft")).rejects.toThrow(/without a job_card_events row/i);
    await expect(ins("approved")).rejects.toThrow(/starts as a draft/i);
  });

  it("events cannot be edited or deleted", async () => {
    const id = await submitted();
    await expect(raw(owner(), (q) => q.query("update job_card_events set comment = 'x' where job_card_id = $1", [id]))).rejects.toThrow(/append-only/i);
    await expect(raw(owner(), (q) => q.query("delete from job_card_events where job_card_id = $1", [id]))).rejects.toThrow(/append-only/i);
  });

  it("every change is in the audit log with the actor", async () => {
    const id = await submitted();
    await jc.transitionJobCard(d, mgr(), id, "approved");
    const rows = await raw(owner(), async (q) => (await q.query<{ actor_id: string }>("select actor_id from audit_log where table_name = 'job_cards' and row_id = $1 and action = 'UPDATE'", [id])).rows);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    expect(rows.at(-1)!.actor_id).toBe(U(12));
  });
});

describe("returned for edit", () => {
  it("goes back to the requester, who edits and resubmits; nobody else can edit", async () => {
    const id = await submitted();
    await jc.transitionJobCard(d, mgr(), id, "returned_for_edit", { comment: "Add the quotation reference" });
    expect((await jc.listNotifications(d, driver())).some((n) => n.kind === "jobcard.returned_for_edit" && n.payload.job_card_id === id)).toBe(true);

    await expect(jc.editJobCard(d, mgr2(), id, card({ cause_text: "Manager tries to rewrite it" }), false)).rejects.toThrow(/only the requester/i);
    await jc.editJobCard(d, driver(), id, card({ cause_text: "Front brake pads worn; quotation ref QT-77", lines: [{ kind: "part", description: "Pads", qty: "1", unit_cost: "2000" }] }), true);
    const c = (await jc.getJobCard(d, driver(), id))!;
    expect(c.status).toBe("submitted");
    expect(c.cause_text).toMatch(/QT-77/);
    expect(c.estimated_cost).toBe("2000.00");
    expect((await events(id)).map((e) => e.to_status)).toEqual(["draft", "submitted", "returned_for_edit", "submitted"]);
  });

  it("a submitted card cannot be edited", async () => {
    const id = await submitted();
    await expect(jc.editJobCard(d, driver(), id, card(), false)).rejects.toThrow(/only a draft or a returned/i);
  });

  it("the requester can cancel a draft; others cannot", async () => {
    const id = (await jc.createJobCard(d, driver(), card(), false)).id;
    await expect(jc.transitionJobCard(d, driver2(), id, "cancelled")).rejects.toThrow();
    await jc.transitionJobCard(d, driver(), id, "cancelled");
    expect(await statusOf(id)).toBe("cancelled");
  });
});

describe("vendor assignment", () => {
  it("needs an active vendor and the assign permission", async () => {
    const id = await submitted();
    await jc.transitionJobCard(d, mgr(), id, "approved");
    const v = await master.saveVendor(d, owner(), { name: "Quick Fix Motors", categories: ["engine"] });
    await expect(jc.transitionJobCard(d, mgr(), id, "vendor_assigned")).rejects.toThrow(/active vendor/i);
    await master.setVendorStatus(d, owner(), v.id, "blocked");
    await expect(jc.transitionJobCard(d, mgr(), id, "vendor_assigned", { vendorId: v.id })).rejects.toThrow(/active vendor/i);
    await master.setVendorStatus(d, owner(), v.id, "active");
    await expect(jc.transitionJobCard(d, finance(), id, "vendor_assigned", { vendorId: v.id })).rejects.toBeInstanceOf(ForbiddenError);
    await jc.transitionJobCard(d, mgr(), id, "vendor_assigned", { vendorId: v.id });
    expect((await jc.getJobCard(d, mgr(), id))!.vendor_name).toBe("Quick Fix Motors");
  });
});

describe("permissions", () => {
  // create = jobcard.create, decide = jobcard.approve, read = read_all or read_own
  const roles: Record<string, { create: boolean; decide: boolean; read: boolean }> = {
    tenant_admin: { create: true, decide: true, read: true },
    fleet_manager: { create: true, decide: true, read: true },
    finance: { create: false, decide: false, read: true },
    requester: { create: true, decide: false, read: true },
    auditor: { create: false, decide: false, read: true },
    vendor: { create: false, decide: false, read: false },
  };
  for (const [role, want] of Object.entries(roles)) {
    it(`${role}: create=${want.create} decide=${want.decide} read=${want.read}`, async () => {
      const m = mem(role, 50);
      const forbidden = (p: Promise<unknown>) => p.then(() => false, (e) => e instanceof ForbiddenError);
      expect(!(await forbidden(jc.createJobCard(d, m, card(), false)))).toBe(want.create);
      const id = await submitted();
      expect(!(await forbidden(jc.transitionJobCard(d, m, id, "rejected", { comment: "Not needed this time" })))).toBe(want.decide);
      expect(!(await forbidden(jc.listJobCards(d, m)))).toBe(want.read);
    });
  }
});

describe("who sees what", () => {
  it("a requester sees only cards they raised or hold the vehicle for; managers and auditors see all", async () => {
    const mine = await submitted(driver());
    const theirs = (await jc.createJobCard(d, driver2(), card({ vehicle_id: veh2 }), true)).id;
    const seen = (await jc.listJobCards(d, driver())).map((r) => r.id);
    expect(seen).toContain(mine);
    expect(seen).not.toContain(theirs);
    expect(await jc.getJobCard(d, driver(), theirs)).toBeNull();
    for (const m of [mgr(), auditor(), finance(), owner()]) {
      const all = (await jc.listJobCards(d, m)).map((r) => r.id);
      expect(all).toEqual(expect.arrayContaining([mine, theirs]));
    }
  });

  it("filters by status and search", async () => {
    const id = await submitted();
    await jc.transitionJobCard(d, mgr(), id, "rejected", { comment: "Duplicate request" });
    const rej = await jc.listJobCards(d, mgr(), { status: "rejected" });
    expect(rej.every((r) => r.status === "rejected")).toBe(true);
    expect((await jc.listJobCards(d, mgr(), { search: "bkl-300" })).every((r) => r.registration_no === "BKL-300")).toBe(true);
  });

  it("another workspace sees none of it", async () => {
    const id = await submitted();
    const o = mem("fleet_manager", 60, other);
    expect(await jc.listJobCards(d, o)).toEqual([]);
    expect(await jc.getJobCard(d, o, id)).toBeNull();
  });
});

describe("notifications", () => {
  it("are per user, can be marked read, and are counted", async () => {
    await submitted();
    expect(await jc.unreadCount(d, mgr())).toBeGreaterThan(0);
    await jc.markNotificationsRead(d, mgr());
    expect(await jc.unreadCount(d, mgr())).toBe(0);
    expect(await jc.unreadCount(d, mem("vendor", 70))).toBe(0);
  });
});
