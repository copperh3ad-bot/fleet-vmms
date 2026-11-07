import { mkdtempSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { runDocumentReminders, buildReminderMail } from "@/lib/compliance/reminders";

// ADR-062: daily reminders for periodic maintenance that is due soon or overdue, and one email a day per person when a mail service is set up.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

let emps: Record<number, string>;
let van: string, car: string;
const notes = (user: number, like = "service.%") => raw(async (q) => (await q.query<{ kind: string; payload: Record<string, unknown> }>(
  "select kind, payload from notifications where user_id = $1 and kind like $2 order by created_at, id", [U(user), like])).rows);
const baseline = (vehicle: string, daysAgo: number) => raw(async (q) => {
  await q.query("delete from vehicle_service_baselines where vehicle_id = $1 and service_type_key = 'oil_change'", [vehicle]);
  await q.query("insert into vehicle_service_baselines(vehicle_id, service_type_key, last_done_on) values ($1, 'oil_change', current_date - $2::int)", [vehicle, daysAgo]);
});

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Pm Reminders Ltd", slug: "pmr", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  emps = {};
  for (const [n, name] of [[41, "Holder One"], [42, "Manager Two"], [43, "Holder Three"]] as const) {
    emps[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `P-${n}`, email: n === 43 ? undefined : `p${n}@example.com` })).id;
    await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), emps[n]]));
  }
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[41, "requester"], [42, "fleet_manager"], [43, "requester"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  // Oil change every 3 months, no distance rule, and a two-week warning: a service done 80 days ago is due soon, 100 days ago is overdue.
  await raw(async (q) => {
    await q.query("update service_types set interval_months = 3, interval_km = null where key = 'oil_change'");
    await q.query("insert into settings(key, value) values ('pm_warning_days', '14') on conflict (key) do update set value = '14'");
  });
  van = (await master.addVehicle(d, owner(), { registration_no: "PMR-001", make: "Toyota", model: "Hiace", employee_id: emps[41], holding_since: "2026-01-01" })).id;
  car = (await master.addVehicle(d, owner(), { registration_no: "PMR-002", make: "Honda", model: "City", employee_id: emps[43], holding_since: "2026-01-01" })).id;
});

describe("maintenance due reminders", () => {
  it("says nothing while the service is not near", async () => {
    await baseline(van, 10);
    await runDocumentReminders(d);
    expect(await notes(41)).toHaveLength(0);
    expect(await notes(42)).toHaveLength(0);
  });

  it("tells the holder and the fleet manager once when it becomes due soon, with the plate and service", async () => {
    await baseline(van, 80);
    await runDocumentReminders(d);
    const holder = await notes(41), manager = await notes(42);
    expect(holder.map((n) => n.kind)).toEqual(["service.due"]);
    expect(manager.map((n) => n.kind)).toEqual(["service.due"]);
    expect(String(holder[0].payload.text)).toMatch(/^PMR-001: .* is due by \d{2}\/\d{2}\/\d{2}/);
    expect((await notes(43))).toHaveLength(0);                                   // someone holding another vehicle is not told
    await runDocumentReminders(d); await runDocumentReminders(d);                // again, the same day: nothing new
    expect(await notes(41)).toHaveLength(1);
  });

  it("tells them again, once, when it becomes overdue", async () => {
    await baseline(van, 100);
    await runDocumentReminders(d);
    expect((await notes(41)).map((n) => n.kind)).toEqual(["service.due", "service.overdue"]);
    await runDocumentReminders(d);
    expect(await notes(41)).toHaveLength(2);
  });

  it("starts a new cycle after the service is done, and a straight-to-overdue service gets one overdue notice", async () => {
    await baseline(van, 79);                                                      // done again a day later: a new cycle, due soon once more
    await runDocumentReminders(d);
    expect((await notes(41)).map((n) => n.kind)).toEqual(["service.due", "service.overdue", "service.due"]);
    await baseline(car, 120);                                                     // never warned, already overdue
    await runDocumentReminders(d);
    expect((await notes(43)).map((n) => n.kind)).toEqual(["service.overdue"]);
  });

  it("leaves a vehicle that is not active alone", async () => {
    const before = (await notes(42)).length;
    const idle = (await master.addVehicle(d, owner(), { registration_no: "PMR-003", make: "Suzuki", model: "Alto" })).id;
    await baseline(idle, 120);
    await raw((q) => q.query("update vehicles set status = 'in_workshop' where id = $1", [idle]));
    await runDocumentReminders(d);
    expect((await notes(42)).length).toBe(before);
  });
});

describe("the email", () => {
  const KEYS = ["SMTP_URL", "EMAIL_FROM", "ALLOW_FILE_MAILER"];
  const before: Record<string, string | undefined> = {};
  let out: string;
  const mails = () => (existsSync(out) ? readFileSync(out, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; subject: string; text: string }) : []);
  beforeAll(() => { for (const k of KEYS) before[k] = process.env[k]; out = join(mkdtempSync(join(tmpdir(), "rem-")), "mail.jsonl"); });
  afterAll(() => { for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } });

  it("sends nothing when no mail service is set up, and the notices are still made", async () => {
    delete process.env.SMTP_URL; delete process.env.EMAIL_FROM;
    const idle = (await master.addVehicle(d, owner(), { registration_no: "PMR-004", make: "Kia", model: "Sportage", employee_id: emps[41], holding_since: "2026-01-01" })).id;
    await baseline(idle, 100);
    const runs = await runDocumentReminders(d);
    expect(runs.find((r) => r.schema === t.schema)).toMatchObject({ sent: 1, emailed: 0 });
    expect(mails()).toHaveLength(0);
  });

  it("sends one email a day per person with an email address, listing what is new, and skips a person without one", async () => {
    process.env.ALLOW_FILE_MAILER = "1"; process.env.SMTP_URL = `file:${out}`; process.env.EMAIL_FROM = "Fleet OTG <noreply@example.com>";
    const a = (await master.addVehicle(d, owner(), { registration_no: "PMR-005", make: "Toyota", model: "Yaris", employee_id: emps[41], holding_since: "2026-01-01" })).id;
    const b = (await master.addVehicle(d, owner(), { registration_no: "PMR-006", make: "Toyota", model: "Corolla", employee_id: emps[43], holding_since: "2026-01-01" })).id;
    await baseline(a, 100); await baseline(b, 100);
    const runs = await runDocumentReminders(d);
    expect(runs.find((r) => r.schema === t.schema)).toMatchObject({ sent: 2, emailed: 2 });
    const sent = mails();
    expect(sent.map((m) => m.to).sort()).toEqual(["p41@example.com", "p42@example.com"]);          // Holder Three has no email on record
    const manager = sent.find((m) => m.to === "p42@example.com")!;
    expect(manager.text).toContain("PMR-005");
    expect(manager.text).toContain("PMR-006");
    const holder = sent.find((m) => m.to === "p41@example.com")!;
    expect(holder.text).toContain("PMR-005");
    expect(holder.text).not.toContain("PMR-006");
    await runDocumentReminders(d);
    expect(mails()).toHaveLength(2);                                                                  // nothing new, no email
  });

  it("builds a readable digest with a link to the notices", () => {
    const m = buildReminderMail("x@example.com", "Hina", "Acme", "acme", ["PMR-001: Oil change is overdue", "Ali's driving licence expires in 14 days"]);
    expect(m.subject).toBe("Fleet OTG reminders for Acme: 2 items need attention");
    expect(m.text).toContain("/w/acme/notifications");
    expect(m.text).not.toMatch(/licence number|LHR-/);
  });
});
