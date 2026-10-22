import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as ja from "@/lib/jobcards/attachments";
import * as cs from "@/lib/compliance/service";
import { runDocumentReminders } from "@/lib/compliance/reminders";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 12);

const day = (offset: number, from = new Date()) => { const x = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offset)); return x.toISOString().slice(0, 10); };
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

let vehA: string, vehB: string, vehC: string, empOld: string, empNew: string;
const doc = (vehicle: string, type: string, expiresInDays: number, extra: Record<string, unknown> = {}) =>
  cs.addDocument(d, mgr(), { vehicle_id: vehicle, doc_type: type, reference: `REF-${Math.random().toString(36).slice(2, 7)}`, expires_on: day(expiresInDays), ...extra });
const notices = (user: number, kind?: string) => raw(async (q) => (await q.query<{ payload: Record<string, unknown>; kind: string }>(
  `select kind, payload from notifications where user_id = $1 ${kind ? "and kind = $2" : ""} order by created_at, id`, kind ? [U(user), kind] : [U(user)])).rows);
const fakeStore = () => {
  const files = new Map<string, Uint8Array>();
  const store: ja.BlobStore = { async put(p, b) { files.set(p, b); }, async remove(p) { files.delete(p); }, async signedUrl(p) { return files.has(p) ? `https://signed.example/${p}` : null; } };
  return { store, files };
};
const jpeg = () => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  const people: [number, string][] = [[11, "Driver One"], [12, "Manager One"], [13, "Driver Two"]];
  const ids: Record<number, string> = {};
  for (const [n, name] of people) {
    ids[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` })).id;
    await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), ids[n]]));
  }
  empOld = ids[11]; empNew = ids[13];
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[11, "requester"], [12, "fleet_manager"], [13, "requester"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  vehA = (await master.addVehicle(d, owner(), { registration_no: "BKL-245", employee_id: empOld, holding_since: "2026-01-01" })).id;
  vehB = (await master.addVehicle(d, owner(), { registration_no: "BKL-300" })).id;
  vehC = (await master.addVehicle(d, owner(), { registration_no: "BKL-400" })).id;
  await master.changeCustody(d, owner(), { vehicle_id: vehA, employee_id: empNew, from: "2026-06-01" });
});

describe("documents", () => {
  it("insurance needs insurer, policy number and a start date; the others need only an expiry", async () => {
    const e = await cs.addDocument(d, mgr(), { vehicle_id: vehB, doc_type: "insurance", expires_on: day(200) }).catch((x) => x);
    expect(e).toBeInstanceOf(UserError);
    expect(Object.keys(e.fields).sort()).toEqual(["issued_by", "reference", "valid_from"]);
    const ok = await cs.addDocument(d, mgr(), { vehicle_id: vehB, doc_type: "insurance", issued_by: "EFU", reference: "POL-1", valid_from: day(-165), expires_on: day(200), amount: "45000" });
    expect(ok.entity_type).toBe("insurance_policy");
    expect((await cs.addDocument(d, mgr(), { vehicle_id: vehB, doc_type: "fitness", expires_on: day(300) })).entity_type).toBe("compliance_doc");
    const bad = await cs.addDocument(d, mgr(), { vehicle_id: vehB, doc_type: "fitness", valid_from: day(10), expires_on: day(5) }).catch((x) => x);
    expect(bad.fields.expires_on).toMatch(/before the start/);
    const none = await cs.addDocument(d, mgr(), { vehicle_id: vehB, doc_type: "fitness" }).catch((x) => x);
    expect(none.fields.expires_on).toBeTruthy();
  });

  it("a renewal replaces the old one in the list and keeps it in the history", async () => {
    const old = await doc(vehC, "token_tax", 5);
    expect((await cs.listDocuments(d, mgr(), { type: "token_tax", search: "bkl-400" }))[0].entity_id).toBe(old.id);
    const renewed = await doc(vehC, "token_tax", 370);
    const list = (await cs.listDocuments(d, mgr(), { type: "token_tax", search: "bkl-400" }));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ entity_id: renewed.id, doc_status: "ok" });
    const detail = (await cs.getDocument(d, mgr(), "compliance_doc", old.id))!;
    expect(detail.current).toBe(false);
    expect(detail.history.map((h) => h.id)).toEqual([renewed.id, old.id]);
    expect((await cs.getDocument(d, mgr(), "compliance_doc", renewed.id))!.current).toBe(true);
    expect(await cs.getDocument(d, mgr(), "nonsense", old.id)).toBeNull();
  });

  it("status buckets and filters", async () => {
    const v = (await master.addVehicle(d, owner(), { registration_no: "STAT-1" })).id;
    await doc(v, "registration", -3); await doc(v, "fitness", 20); await doc(v, "route_permit", 60); await doc(v, "other", 400);
    const by = Object.fromEntries((await cs.listDocuments(d, mgr(), { search: "STAT-1" })).map((r) => [r.doc_type, r.doc_status]));
    expect(by).toEqual({ registration: "expired", fitness: "due_30", route_permit: "due_90", other: "ok" });
    expect((await cs.listDocuments(d, mgr(), { search: "STAT-1", status: "expired" })).map((r) => r.doc_type)).toEqual(["registration"]);
    const missing = await cs.listMissingDocuments(d, mgr(), ["registration", "token_tax"]);
    expect(missing.filter((x) => x.registration_no === "STAT-1").map((x) => x.doc_type)).toEqual(["token_tax"]);
  });

  it("documents of vehicles that are no longer in service are not listed", async () => {
    const v = (await master.addVehicle(d, owner(), { registration_no: "GONE-1" })).id;
    await doc(v, "registration", 10);
    expect(await cs.listDocuments(d, mgr(), { search: "GONE-1" })).toHaveLength(1);
    await master.updateVehicleStatus(d, owner(), v, "disposed");
    expect(await cs.listDocuments(d, mgr(), { search: "GONE-1" })).toHaveLength(0);
  });
});

describe("reminders", () => {
  // These tests use their own vehicles and a fixed "today" so they do not depend on the calendar.
  const TODAY = "2031-03-01";
  const at = (offset: number) => day(offset, new Date(`${TODAY}T00:00:00Z`));
  const remindersFor = (entity: string) => raw(async (q) => (await q.query<{ days_before: number }>("select days_before from document_reminders where entity_id = $1 order by days_before desc", [entity])).rows.map((r) => r.days_before));
  const run = async (today: string) => (await runDocumentReminders(d, today)).filter((r) => r.schema === t.schema);
  const newCar = async (plate: string) => (await master.addVehicle(d, owner(), { registration_no: plate })).id;
  const forPlate = async (user: number, plate: string, kind?: string) => (await notices(user, kind)).filter((n) => n.payload.plate === plate);

  it("sends each threshold once as the date gets closer, then once when it expires", async () => {
    const v = await newCar("REM-1");
    const x = await cs.addDocument(d, mgr(), { vehicle_id: v, doc_type: "fitness", reference: "F-1", expires_on: at(50) });
    expect((await run(TODAY))[0].sent).toBeGreaterThanOrEqual(1);          // inside 60 days
    expect((await forPlate(12, "REM-1")).map((n) => n.payload.days_left)).toEqual([50]);
    await run(TODAY); await run(at(5));                                      // same day again, and a few days later: nothing new
    expect(await forPlate(12, "REM-1")).toHaveLength(1);
    await run(at(21));                                                       // 29 days left: crosses 30
    await run(at(37));                                                       // 13 days left: crosses 14
    await run(at(37));
    expect((await forPlate(12, "REM-1")).map((n) => n.payload.days_left)).toEqual([50, 29, 13]);
    await run(at(51)); await run(at(60));                                    // expired: one notice, not one per day
    const all = await forPlate(12, "REM-1");
    expect(all.map((n) => n.kind)).toEqual(["document.expiring", "document.expiring", "document.expiring", "document.expired"]);
    expect(await remindersFor(x.id)).toEqual([60, 30, 14, 0]);
  });

  it("a document first entered late gets one notice, for the tightest threshold, not three", async () => {
    const v = await newCar("REM-2");
    const x = await cs.addDocument(d, mgr(), { vehicle_id: v, doc_type: "registration", expires_on: at(10) });
    await run(TODAY);
    expect(await forPlate(12, "REM-2")).toHaveLength(1);
    expect(await remindersFor(x.id)).toEqual([60, 30, 14]);                 // wider ones are marked claimed so they never fire later
    await run(at(1)); await run(at(2));
    expect(await forPlate(12, "REM-2")).toHaveLength(1);
  });

  it("nothing for a document that is far away, and a renewal starts a fresh set", async () => {
    const v = await newCar("REM-3");
    const first = await cs.addDocument(d, mgr(), { vehicle_id: v, doc_type: "token_tax", expires_on: at(90) });
    await run(TODAY);
    expect(await forPlate(12, "REM-3")).toHaveLength(0);
    await run(at(40));                                                       // 50 days left
    expect(await forPlate(12, "REM-3")).toHaveLength(1);
    const renewed = await cs.addDocument(d, mgr(), { vehicle_id: v, doc_type: "token_tax", expires_on: at(455) });
    await run(at(100));                                                      // the old one is past, but it has been replaced: no "expired" notice
    expect(await forPlate(12, "REM-3")).toHaveLength(1);
    expect(await remindersFor(renewed.id)).toEqual([]);
    expect(await remindersFor(first.id)).toEqual([60]);
  });

  it("tells the people who manage compliance and the current holder, once each, and nobody else", async () => {
    const v = await newCar("REM-4");
    await master.changeCustody(d, owner(), { vehicle_id: v, employee_id: empNew, from: "2026-01-01" });
    await cs.addDocument(d, mgr(), { vehicle_id: v, doc_type: "fitness", expires_on: at(20) });
    await run(TODAY);
    expect(await forPlate(12, "REM-4")).toHaveLength(1);        // manager
    expect(await forPlate(13, "REM-4")).toHaveLength(1);        // the holder
    expect(await forPlate(11, "REM-4")).toHaveLength(0);        // a different driver
    expect((await forPlate(13, "REM-4"))[0].payload).toMatchObject({ doc: "Fitness certificate", expires_on: at(20), days_left: 20 });
  });

  it("respects the tenant's own thresholds, and skips vehicles that are out of service", async () => {
    await raw((q) => q.query("update settings set value = '7' where key = 'doc_reminder_days'"));
    const a = await newCar("REM-5"), b = await newCar("REM-6");
    await cs.addDocument(d, mgr(), { vehicle_id: a, doc_type: "fitness", expires_on: at(20) });
    await cs.addDocument(d, mgr(), { vehicle_id: b, doc_type: "fitness", expires_on: at(5) });
    await master.updateVehicleStatus(d, owner(), b, "inactive");
    await run(TODAY);
    expect(await forPlate(12, "REM-5")).toHaveLength(0);        // 20 days left, only 7 configured
    expect(await forPlate(12, "REM-6")).toHaveLength(0);        // inactive
    await run(at(14));
    expect(await forPlate(12, "REM-5")).toHaveLength(1);        // 6 days left
    await raw((q) => q.query("update settings set value = '60,30,14' where key = 'doc_reminder_days'"));
  });

  it("two runs at the same moment send one notice, not two", async () => {
    const v = await newCar("REM-7");
    await cs.addDocument(d, mgr(), { vehicle_id: v, doc_type: "fitness", expires_on: at(12) });
    await Promise.all([run(TODAY), run(TODAY), run(TODAY)]);
    expect(await forPlate(12, "REM-7")).toHaveLength(1);
  });

  it("a failing workspace does not stop the others, and suspended ones are skipped", async () => {
    const other = await provisionTenant(d, { name: "Other Co", slug: "other", ownerUserId: U(2), ownerName: "O" }, tenantMigrations(), { transform: stripExt });
    const broken = await provisionTenant(d, { name: "Broken Co", slug: "broken", ownerUserId: U(3), ownerName: "B" }, tenantMigrations(), { transform: stripExt });
    const asked = await provisionTenant(d, { name: "Paused Co", slug: "paused", ownerUserId: U(4), ownerName: "P" }, tenantMigrations(), { transform: stripExt });
    await withTenant(d, { schema: broken.schema, userId: U(3), role: "tenant_admin" }, (q) => q.query("drop function claim_document_reminders(date)"));
    await withPlatform(d, (q) => q.query("update public.tenants set status = 'suspended' where id = $1", [asked.tenantId]));
    const res = await runDocumentReminders(d, TODAY);
    expect(res.find((r) => r.schema === broken.schema)?.error).toBeTruthy();
    expect(res.find((r) => r.schema === other.schema)).toMatchObject({ sent: 0 });
    expect(res.find((r) => r.schema === other.schema)?.error).toBeUndefined();
    expect(res.find((r) => r.schema === t.schema)?.error).toBeUndefined();
    expect(res.find((r) => r.schema === asked.schema)).toBeUndefined();
  });
});

describe("accidents", () => {
  it("fills the driver from custody on that date and keeps what was typed", async () => {
    const before = await cs.addAccident(d, mgr(), { vehicle_id: vehA, occurred_at: "2026-03-10T09:30", description: "Rear-ended at the traffic light", severity: "minor", fault: "third_party", insurance_claim: "on", claim_ref: "CLM-9" });
    const after = await cs.addAccident(d, mgr(), { vehicle_id: vehA, occurred_at: "2026-08-10T09:30", description: "Scraped a gate while reversing", severity: "moderate" });
    expect((await cs.getAccident(d, mgr(), before))).toMatchObject({ driver_name: "Driver One", insurance_claim: true, claim_ref: "CLM-9", fault: "third_party" });
    expect((await cs.getAccident(d, mgr(), after))!.driver_name).toBe("Driver Two");
    expect((await cs.listAccidents(d, mgr())).map((a) => a.id)).toEqual(expect.arrayContaining([before, after]));
  });

  it("refuses the future, a vague description, a claim reference without a claim, and a job card of another vehicle", async () => {
    const base = { vehicle_id: vehA, description: "Hit a pole in the car park", severity: "minor" };
    const f = await cs.addAccident(d, mgr(), { ...base, occurred_at: "2999-01-01T10:00" }).catch((x) => x);
    expect(f.fields.occurred_at).toMatch(/future/);
    expect((await cs.addAccident(d, mgr(), { ...base, occurred_at: "2026-03-10T09:30", description: "bump" }).catch((x) => x)).fields.description).toBeTruthy();
    await expect(cs.addAccident(d, mgr(), { ...base, occurred_at: "2026-03-10T09:30", claim_ref: "X-1" })).rejects.toThrow(/insurance claim/);
    const reason = (await raw(async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'ACC_COLLISION'")).rows[0])).id;
    const card = await jc.createJobCard(d, mem("fleet_manager", 12), { vehicle_id: vehB, requested_by: empOld, reason_code_id: reason, cause_text: "Collision damage to the front", lines: [] }, false);
    await expect(cs.addAccident(d, mgr(), { ...base, occurred_at: "2026-03-10T09:30", job_card_id: card.id })).rejects.toThrow(/not for this vehicle/);
    const ok = await cs.addAccident(d, mgr(), { vehicle_id: vehB, description: "Front bumper crushed in a collision", severity: "major", occurred_at: "2026-03-10T09:30", job_card_id: card.id });
    expect((await cs.getAccident(d, mgr(), ok))!.job_no).toBe(card.job_no);
  });
});

describe("challans", () => {
  it("takes the driver from custody on the issue date, and tracks paid and disputed", async () => {
    const c1 = await cs.addChallan(d, mgr(), { vehicle_id: vehA, issued_on: "2026-02-01", reference: "CH-1", violation: "Speeding", amount: "5000" });
    const c2 = await cs.addChallan(d, mgr(), { vehicle_id: vehA, issued_on: "2026-07-01", violation: "No seat belt", amount: "1500" });
    const rows = await cs.listChallans(d, mgr());
    expect(rows.find((r) => r.id === c1)!.driver_name).toBe("Driver One");
    expect(rows.find((r) => r.id === c2)!.driver_name).toBe("Driver Two");
    await cs.setChallanStatus(d, mgr(), c1, "paid");
    expect((await cs.listChallans(d, mgr(), { status: "paid" })).find((r) => r.id === c1)!.paid_on).toBe(day(0));
    await cs.setChallanStatus(d, mgr(), c1, "disputed");
    expect((await cs.listChallans(d, mgr())).find((r) => r.id === c1)).toMatchObject({ status: "disputed", paid_on: null });
    await expect(cs.setChallanStatus(d, mgr(), c1, "bogus" as never)).rejects.toThrow(UserError);
    await expect(cs.setChallanStatus(d, mgr(), "00000000-0000-0000-0000-0000000000ff", "paid")).rejects.toThrow(/not found/);
  });
  it("refuses a negative amount, a future date and a missing amount", async () => {
    const b = { vehicle_id: vehA };
    expect((await cs.addChallan(d, mgr(), { ...b, issued_on: "2026-02-01", amount: "-5" }).catch((x) => x)).fields.amount).toBeTruthy();
    expect((await cs.addChallan(d, mgr(), { ...b, issued_on: "2999-02-01", amount: "5" }).catch((x) => x)).fields.issued_on).toMatch(/future/);
    expect((await cs.addChallan(d, mgr(), { ...b, issued_on: "2026-02-01" }).catch((x) => x)).fields.amount).toBeTruthy();
  });
});

describe("files", () => {
  it("attach to documents, accidents and challans; same checks as job card files", async () => {
    const { store, files } = fakeStore();
    const x = await doc(vehB, "other", 100);
    const acc = (await cs.listAccidents(d, mgr()))[0].id;
    const ch = (await cs.listChallans(d, mgr()))[0].id;
    for (const [type, id] of [["compliance_doc", x.id], ["accident", acc], ["challan", ch]] as const)
      await cs.addComplianceFile(d, store, mgr(), type, id, { name: "scan.jpg", bytes: jpeg() });
    expect([...files.keys()].every((k) => k.startsWith(`${t.schema}/`))).toBe(true);
    const list = await cs.listComplianceFiles(d, store, mem("auditor", 15), "compliance_doc", x.id);
    expect(list).toHaveLength(1);
    expect(list[0].url).toContain(`/compliance_doc/${x.id}/`);
    await expect(cs.addComplianceFile(d, store, mgr(), "compliance_doc", x.id, { name: "x.exe", bytes: jpeg() })).rejects.toBeInstanceOf(UserError);
    await expect(cs.addComplianceFile(d, store, mgr(), "job_card", x.id, { name: "a.jpg", bytes: jpeg() })).rejects.toThrow(/cannot be attached/);
    await expect(cs.addComplianceFile(d, store, mgr(), "accident", "00000000-0000-0000-0000-0000000000ee", { name: "a.jpg", bytes: jpeg() })).rejects.toThrow(/not found/);
    await cs.removeComplianceFile(d, store, mgr(), list[0].id);
    expect(await cs.listComplianceFiles(d, store, mgr(), "compliance_doc", x.id)).toEqual([]);
    expect([...files.keys()].some((k) => k.includes(x.id))).toBe(false);
  });

  it("the database refuses a file for a record that does not exist, for every kind", async () => {
    for (const type of ["accident", "challan", "compliance_doc", "insurance_policy", "quotation", "invoice"])
      await expect(raw((q) => q.query("insert into attachments(entity_type, entity_id, storage_path, file_name) values ($1, $2, $3, 'x.jpg')",
        [type, "00000000-0000-0000-0000-0000000000dd", `${t.schema}/${type}/x/a.jpg`]))).rejects.toThrow(/target not found/);
  });

  it("job card files cannot be removed through the compliance door", async () => {
    const { store } = fakeStore();
    const reason = (await raw(async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0])).id;
    const card = await jc.createJobCard(d, mgr(), { vehicle_id: vehA, requested_by: empNew, reason_code_id: reason, cause_text: "Brake pads worn out badly", lines: [] }, false);
    await ja.addJobCardAttachment(d, store, mgr(), card.id, { name: "a.jpg", bytes: jpeg() });
    const [f] = await ja.listJobCardAttachments(d, store, mgr(), card.id);
    await expect(cs.removeComplianceFile(d, store, mgr(), f.id)).rejects.toThrow(/not found/);
  });
});

describe("permissions", () => {
  it("manage = tenant admin and fleet manager; read also for finance and auditor; nothing for requester or vendor", async () => {
    const forbidden = (p: Promise<unknown>) => p.then(() => false, (e) => e instanceof ForbiddenError);
    const input = { vehicle_id: vehB, doc_type: "other", expires_on: day(500) };
    const matrix: Record<string, { read: boolean; write: boolean }> = {
      tenant_admin: { read: true, write: true }, fleet_manager: { read: true, write: true }, finance: { read: true, write: false },
      auditor: { read: true, write: false }, requester: { read: false, write: false }, vendor: { read: false, write: false },
    };
    for (const [role, want] of Object.entries(matrix)) {
      const m = mem(role, 70);
      expect(!(await forbidden(cs.listDocuments(d, m))), `${role} read`).toBe(want.read);
      expect(!(await forbidden(cs.listAccidents(d, m))), `${role} accidents`).toBe(want.read);
      expect(!(await forbidden(cs.listChallans(d, m))), `${role} challans`).toBe(want.read);
      expect(!(await forbidden(cs.addDocument(d, m, input))), `${role} write`).toBe(want.write);
      expect(!(await forbidden(cs.addChallan(d, m, { vehicle_id: vehB, issued_on: "2026-01-01", amount: "1" }))), `${role} challan write`).toBe(want.write);
    }
  });
  it("another workspace sees none of it", async () => {
    const other = await provisionTenant(d, { name: "Third Co", slug: "third", ownerUserId: U(5), ownerName: "T" }, tenantMigrations(), { transform: stripExt });
    const o: Membership = { ...other, userId: U(80), role: "fleet_manager", vehicleScope: "all" };
    expect(await cs.listDocuments(d, o)).toEqual([]);
    expect(await cs.listAccidents(d, o)).toEqual([]);
    expect(await cs.getDocument(d, o, "compliance_doc", (await cs.listDocuments(d, mgr()))[0].entity_id)).toBeNull();
  });
});
