// Demo data for showing the system without real records (Delta Textiles, BKL-245 and friends). Used only by
// scripts/seed-demo.mts and the tests. It goes through the same services as the screens, so every rule applies, and it
// refuses to run in a workspace that already has vehicles. The people it creates have no login.
import { randomUUID } from "node:crypto";
import type { Driver } from "@/lib/db/types";
import { withTenant } from "@/lib/db/tenant";
import type { Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as vf from "@/lib/vendorflow/service";
import * as cs from "@/lib/compliance/service";
import * as ct from "@/lib/control/service";
import * as od from "@/lib/odometer/service";

export type SeedSummary = { employees: number; vendors: number; vehicles: number; jobCards: number; documents: number; budgets: number };

const day = (offset: number, from = new Date()) => new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate() + offset)).toISOString().slice(0, 10);

export async function seedDemo(driver: Driver, tenant: { tenantId: string; schema: string }): Promise<SeedSummary> {
  const as = (role: string, userId: string): Membership => ({ ...tenant, userId, role, vehicleScope: "all" });
  const admin = as("tenant_admin", randomUUID());
  const raw = <T,>(m: Membership, fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(driver, m, fn);

  const existing = await raw(admin, async (q) => (await q.query<{ c: number }>("select count(*)::int c from vehicles")).rows[0].c);
  if (existing > 0) throw new Error("This workspace already has vehicles. The demo data is only for an empty workspace.");

  // ---- people (no logins) ----
  const person = async (name: string, no: string, dept: string, login = false) => {
    const e = await master.saveEmployee(driver, admin, { full_name: name, employee_no: no, department: dept, phone: `+92 300 ${String(1000000 + Number(no.replace(/\D/g, "")) * 37).slice(0, 7)}`, email: `${name.split(" ")[0].toLowerCase()}@delta-textiles.example` });
    const userId = randomUUID();
    if (login) await raw(admin, (q) => q.query("update employees set user_id = $1 where id = $2", [userId, e.id]));
    return { id: e.id, userId };
  };
  const imran = await person("Imran Ali", "E-101", "Logistics");
  const bilal = await person("Bilal Raza", "E-102", "Sales");
  const hira = await person("Hira Tariq", "E-103", "Production");
  const usman = await person("Usman Qureshi", "E-104", "Logistics");
  const farah = await person("Farah Naz", "E-105", "Admin");
  const kamran = await person("Kamran Shah", "E-201", "Fleet", true);
  const ayesha = await person("Ayesha Noor", "E-202", "Fleet", true);
  const sana = await person("Sana Malik", "E-301", "Finance", true);
  const manager = as("fleet_manager", kamran.userId), approver = as("fleet_manager", ayesha.userId), finance = as("finance", sana.userId);

  // ---- workshops ----
  const alNoor = (await master.saveVendor(driver, admin, { name: "Al-Noor Auto Works", categories: ["brakes", "engine"], contact: "Tariq Mehmood", phone: "+92 321 5550101" })).id;
  const quickFix = (await master.saveVendor(driver, admin, { name: "Quick Fix Motors", categories: ["electrical", "ac"], contact: "Salman", phone: "+92 321 5550102" })).id;
  await master.saveVendor(driver, admin, { name: "Metro Tyre House", categories: ["tyres"], contact: "Nadeem", phone: "+92 321 5550103" });
  const alNooriUser = randomUUID(), quickUser = randomUUID();
  await raw(admin, async (q) => { await q.query("update vendors set user_id = $1 where id = $2", [alNooriUser, alNoor]); await q.query("update vendors set user_id = $1 where id = $2", [quickUser, quickFix]); });
  const alNooriM = as("vendor", alNooriUser), quickM = as("vendor", quickUser);

  // ---- vehicles, with service history and papers ----
  const veh = async (plate: string, make: string, model: string, year: number, cls: string, fuel: string, km: number, holder: { id: string } | null, oilDaysAgo: number | null, docs: [string, number][]) =>
    (await master.addVehicle(driver, admin, {
      registration_no: plate, make, model, year: String(year), vehicle_class: cls, fuel_type: fuel, odometer_km: String(km), base_location: "Karachi plant",
      ...(holder ? { employee_id: holder.id, holding_since: day(-200) } : {}),
      ...(oilDaysAgo !== null ? { baselines: [{ service_type_key: "oil_change", last_done_on: day(-oilDaysAgo), last_odometer_km: String(Math.max(0, km - 3000)) }] } : {}),
      documents: docs.map(([t, d]) => ({ doc_type: t, reference: `${t.slice(0, 3).toUpperCase()}-${plate}`, expires_on: day(d) })),
    })).id;
  const v245 = await veh("BKL-245", "Isuzu", "D-Max", 2021, "pickup", "diesel", 48210, imran, 20, [["registration", 240], ["fitness", 9], ["token_tax", 300]]);
  const v300 = await veh("BKL-300", "Toyota", "Hilux", 2022, "pickup", "diesel", 31200, bilal, 95, [["registration", 400], ["fitness", 120], ["token_tax", -6]]);
  const v301 = await veh("BKL-301", "Toyota", "Hilux", 2022, "pickup", "diesel", 29850, hira, 60, [["registration", 380], ["fitness", 200], ["token_tax", 150]]);
  const v302 = await veh("BKL-302", "Toyota", "Hilux", 2021, "pickup", "diesel", 62400, usman, 84, [["registration", 90], ["fitness", 45], ["token_tax", 210]]);
  const vLea = await veh("LEA-118", "Suzuki", "Bolan", 2019, "van", "petrol", 91800, farah, 10, [["registration", 500], ["fitness", 22], ["token_tax", 330]]);
  const vTruck = await veh("LEB-770", "Hino", "500", 2018, "truck", "diesel", 204500, null, 40, [["registration", 60], ["fitness", 15], ["route_permit", 130]]);
  await veh("ICT-452", "Honda", "City", 2023, "car", "petrol", 12700, null, null, [["registration", 700]]);
  await raw(admin, (q) => q.query("insert into insurance_policies(vehicle_id, insurer, policy_no, valid_from, valid_to, premium) values ($1, 'EFU General', 'POL-245-26', $2, $3, 62000), ($4, 'Jubilee General', 'POL-300-26', $5, $6, 58000)", [v245, day(-300), day(65), v300, day(-340), day(25)]));

  // ---- budgets ----
  const y = new Date().getUTCFullYear();
  await ct.saveBudget(driver, manager, { period_start: `${y}-01-01`, period_end: `${y}-12-31`, amount: "900000", reason: "Annual fleet plan" });
  await ct.saveBudget(driver, manager, { vehicle_id: v302, period_start: `${y}-01-01`, period_end: `${y}-12-31`, amount: "60000", reason: "Older vehicle, watched closely" });

  // ---- job cards through every stage, back-dated so the reports have something to show ----
  const reasons = Object.fromEntries((await raw(admin, async (q) => (await q.query<{ id: string; code: string }>("select id, code from reason_codes")).rows)).map((r) => [r.code, r.id]));
  const back = (id: string, days: number) => raw(admin, (q) => q.query("update job_cards set created_at = now() - ($2 || ' days')::interval where id = $1", [id, String(days)]));
  const card = async (by: Membership, vehicle: string, requester: { id: string }, reason: string, cause: string, lines: [string, string, number, number][], days: number) => {
    const { id } = await jc.createJobCard(driver, by, { vehicle_id: vehicle, requested_by: requester.id, reason_code_id: reasons[reason], cause_text: cause, priority: "normal",
      lines: lines.map(([kind, description, qty, unit]) => ({ kind, description, qty: String(qty), unit_cost: String(unit) })) }, true);
    await back(id, days);
    return id;
  };
  const toWork = async (id: string, vendor: string, vm: Membership, quote: [string, number, number][]) => {
    await jc.transitionJobCard(driver, approver, id, "approved");
    await jc.transitionJobCard(driver, manager, id, "vendor_assigned", { vendorId: vendor });
    await vf.submitQuotation(driver, vm, id, { days_needed: "2", warranty_months: "3", lines: quote.map(([d, q, u]) => ({ kind: "service", description: d, qty: String(q), unit_cost: String(u) })) });
    const qt = (await vf.getJobFlow(driver, manager, id)).quotations[0];
    await vf.decideQuotation(driver, manager, qt.id, "approve");
    const wo = (await vf.getJobFlow(driver, manager, id)).workOrder!.id;
    return { wo, qt };
  };
  const finish = async (id: string, wo: string, qt: { lines: { id: string; description: string; qty: string; unit_cost: string }[] }, vm: Membership, extra: [string, number][] = []) => {
    await vf.startWork(driver, vm, wo); await vf.completeWork(driver, vm, wo, "Done and road tested");
    await vf.submitInvoice(driver, vm, wo, { invoice_no: `INV-${Math.floor(Math.random() * 9000) + 1000}`, lines: [
      ...qt.lines.map((l) => ({ kind: "service", description: l.description, qty: l.qty, unit_cost: l.unit_cost, quotation_line_id: l.id })),
      ...extra.map(([d, c]) => ({ kind: "other", description: d, qty: "1", unit_cost: String(c) })) ] });
  };

  // closed: a routine oil change, fully paid
  const a = await card(manager, v245, imran, "SVC_ROUTINE", "Scheduled oil and filter change at 45,000 km", [["service", "Engine oil and filter", 1, 9500]], 150);
  const wa = await toWork(a, alNoor, alNooriM, [["Engine oil and filter", 1, 9500]]);
  const flowA = await vf.getJobFlow(driver, manager, a);
  await finish(a, wa.wo, flowA.quotations[0], alNooriM);
  await vf.verifyInvoice(driver, finance, (await vf.listInvoices(driver, finance, { status: "submitted" }))[0].id, "pay_approved");
  await jc.transitionJobCard(driver, finance, a, "closed");

  // a brake job on BKL-302 that came back: a repeat repair attributed to the first workshop
  const b1 = await card(manager, v302, usman, "WEAR_BRAKES", "Brake pedal soft, pads worn on both axles", [["part", "Front brake pads", 2, 6500]], 110);
  const wb1 = await toWork(b1, alNoor, alNooriM, [["Front brake pads", 2, 6500], ["Labour", 1, 3000]]);
  await finish(b1, wb1.wo, (await vf.getJobFlow(driver, manager, b1)).quotations[0], alNooriM, [["Brake fluid top-up", 800]]);
  await vf.verifyInvoice(driver, finance, (await vf.listInvoices(driver, finance, { status: "submitted" }))[0].id, "pay_approved");
  await jc.transitionJobCard(driver, finance, b1, "closed");
  await card(manager, v302, usman, "WEAR_BRAKES", "Brakes squealing again, pedal vibrates under braking", [["part", "Brake discs", 2, 11000]], 52);

  // more history for the cost and peer reports
  await card(manager, v300, bilal, "WEAR_TYRES", "Rear tyres worn below the limit", [["part", "Tyres", 2, 28000]], 75);
  await card(manager, v301, hira, "SVC_ROUTINE", "Scheduled service at 28,000 km", [["service", "Service kit", 1, 14000]], 40);
  await card(manager, vTruck, usman, "DEFECT_PART", "Air compressor not building pressure", [["part", "Compressor", 1, 85000]], 33);

  // in flight at every stage
  const c = await card(manager, v245, imran, "ACC_COLLISION", "Rear bumper and tail light damaged in the car park", [["part", "Rear bumper", 1, 24000], ["part", "Tail light", 1, 6500]], 6);
  await jc.transitionJobCard(driver, approver, c, "approved");
  await jc.transitionJobCard(driver, manager, c, "vendor_assigned", { vendorId: quickFix });
  await vf.submitQuotation(driver, quickM, c, { days_needed: "4", lines: [{ kind: "part", description: "Rear bumper", qty: "1", unit_cost: "26000" }, { kind: "part", description: "Tail light", qty: "1", unit_cost: "7000" }] });
  const d = await card(manager, vLea, farah, "WEAR_BRAKES", "Handbrake does not hold on a slope", [["service", "Handbrake adjustment", 1, 2500]], 4);
  const dw = await toWork(d, alNoor, alNooriM, [["Handbrake adjustment", 1, 2500]]);
  await vf.startWork(driver, alNooriM, dw.wo);
  const e = await card(manager, v300, bilal, "OTHER", "Air conditioning blows warm air", [["service", "AC gas and check", 1, 7000]], 3);
  const ew = await toWork(e, quickFix, quickM, [["AC gas and check", 1, 7000]]);
  await finish(e, ew.wo, (await vf.getJobFlow(driver, manager, e)).quotations[0], quickM, [["Compressor clutch relay", 1800]]);
  await card(manager, v301, hira, "WEAR_TYRES", "Front tyre sidewall bulge", [["part", "Tyre", 1, 28000]], 1);
  const g = await card(manager, vTruck, usman, "DEFECT_PART", "Dashboard warning light for the transmission", [], 2);
  await jc.transitionJobCard(driver, approver, g, "returned_for_edit", { comment: "Add the fault code and an estimate" });
  await jc.createJobCard(driver, manager, { vehicle_id: v245, requested_by: imran.id, reason_code_id: reasons.WEAR_TYRES, cause_text: "Left front tyre losing air slowly", lines: [] }, false);

  // ---- papers, accident, challans ----
  await cs.addAccident(driver, manager, { vehicle_id: v245, occurred_at: `${day(-6)}T16:20`, location: "Plant car park", description: "Reversed into a pillar, rear bumper and tail light damaged", severity: "minor", fault: "our_driver", job_card_id: c });
  await cs.addChallan(driver, manager, { vehicle_id: v300, issued_on: day(-30), reference: "CH-77120", violation: "Over-speeding", amount: "5000" });
  const ch = await cs.addChallan(driver, manager, { vehicle_id: v302, issued_on: day(-75), reference: "CH-66013", violation: "No seat belt", amount: "1500" });
  await cs.setChallanStatus(driver, manager, ch, "paid");

  // ---- this month's odometer cycle: two normal readings, one lower than on file (held), the rest not yet in ----
  const cycleId = await od.openCycle(driver, admin, day(0).slice(0, 7), day(5));
  const cycle = (await od.getCycle(driver, admin, cycleId))!;
  const [r1, r2, r3] = cycle.rows;
  if (r1) await od.enterReading(driver, admin, r1.id, String(Number(r1.last_km) + 320));
  if (r2) await od.enterReading(driver, admin, r2.id, String(Number(r2.last_km) + 410));
  if (r3 && Number(r3.last_km) > 100) await od.enterReading(driver, admin, r3.id, String(Number(r3.last_km) - 40), "Read it quickly at the gate");

  const count = async (t: string) => raw(admin, async (q) => (await q.query<{ c: number }>(`select count(*)::int c from ${t}`)).rows[0].c);
  return { employees: await count("employees"), vendors: await count("vendors"), vehicles: await count("vehicles"), jobCards: await count("job_cards"),
    documents: (await count("compliance_docs")) + (await count("insurance_policies")), budgets: await count("budgets") };
}
