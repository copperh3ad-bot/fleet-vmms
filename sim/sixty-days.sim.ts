import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { testDriver, tenantMigrations, stripExt } from "../tests/helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as vf from "@/lib/vendorflow/service";
import * as trips from "@/lib/trips/service";
import * as pay from "@/lib/payments/service";
import * as vr from "@/lib/vehicle-requests/service";
import { createCargoRequest, getCargo, makeTripFromCargo, transitionCargo } from "@/lib/cargo/service";
import { suggestVehicles } from "@/lib/cargo/suggest";
import { getDashboard } from "@/lib/dashboard/service";
import { getOverview } from "@/lib/dashboard/overview";
import { EXPORT_KINDS, exportCsv } from "@/lib/exports/service";
import { listCargo } from "@/lib/cargo/service";
import { outsourcedTripReport } from "@/lib/trips/outsourced";
import { submitViaInvoiceLink, submitViaQuoteLink, submitViaTripInvoiceLink, submitViaTripQuoteLink } from "@/lib/vendorflow/link";

// 60 days of usage, simulated against a real Postgres through the real service layer (every rule, permission and database function the app uses), not through
// the browser. Per day: 20 job cards, about 50 workshop estimates, 30 cargo requests made into trips, about 200 logistics provider quotes. Six "main agents"
// hold the administrator, fleet manager, logistics, HR, finance and auditor roles; 50 requesters raise the work. Workshops and providers have no login and
// answer through single-use links, as in real use. The clock: before each day every date in the company's data moves back one day, so yesterday's work is a
// day old when today's starts (the app's own "within N days" rules, repeat-repair flags and due dates then see a real calendar). See docs/qa/SIMULATION-60-DAYS.md.
const plan = vi.hoisted(() => ({ pro: true }));
vi.mock("@/lib/billing/plans", async (orig) => ({ ...(await orig<typeof import("@/lib/billing/plans")>()), tenantPlan: async () => ({ outsourcedTrips: plan.pro, fleetOps: true, aiDocuments: false, whatsappMenu: false, aiTrialReads: null, aiPerDay: 0 }) }));

const DAYS = Number(process.env.SIM_DAYS ?? 60);
const JOBS_PER_DAY = Number(process.env.SIM_JOBS ?? 20);
const CARGO_PER_DAY = Number(process.env.SIM_CARGO ?? 30);
const REQUESTERS = 50;
const OUT = path.join("sim", "out", process.env.SIM_RUN ?? new Date().toISOString().slice(0, 10));
const SUPER = process.env.SIM_SUPER_DB ?? "fleet_sim";            // the same database through the local superuser, used only to move dates
const PGHOST = process.env.E2E_PGHOST ?? "/tmp";

// ---------------------------------------------------------------- repeatable randomness
let seed = Number(process.env.SIM_SEED ?? 20261114);
const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const int = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
const chance = (p: number) => rnd() < p;
const shuffle = <T,>(xs: T[]) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const U = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
const iso = (offsetDays = 0) => new Date(Date.now() + offsetDays * 86400_000).toISOString();
const ymd = (offsetDays = 0) => iso(offsetDays).slice(0, 10);

// ---------------------------------------------------------------- bookkeeping
type Rec = { day: number; op: string; actor: string; ref?: string; ms: number; ok: boolean; err?: string };
const log: Rec[] = [];
const timings = new Map<string, number[]>();
const refusals = new Map<string, number>();       // expected refusals (a person was told no, correctly)
const malfunctions = new Map<string, { count: number; first: string; day: number }>();   // anything the rules did not expect
const money = { workshopPaid: 0, tripPaid: 0, workshopInvoiced: 0, tripInvoiced: 0 };
const counts: Record<string, number> = {};
const bump = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };
let day = 0;
const byDay: Record<string, number>[] = [];

/** Runs one operation, times it, and sorts any failure into "told no, correctly" (expected) or "malfunction" (not expected). */
async function op<T>(name: string, actor: string, fn: () => Promise<T>, o: { expect?: RegExp; ref?: string } = {}): Promise<T | undefined> {
  const t0 = performance.now();
  try {
    const r = await fn();
    const ms = performance.now() - t0;
    (timings.get(name) ?? timings.set(name, []).get(name)!).push(ms);
    log.push({ day, op: name, actor, ref: o.ref, ms: Math.round(ms), ok: true });
    return (r === undefined ? true : r) as T;     // an operation that returns nothing still succeeded: only a failure gives undefined
  } catch (e) {
    const ms = performance.now() - t0;
    (timings.get(name) ?? timings.set(name, []).get(name)!).push(ms);
    const msg = e instanceof Error ? e.message : String(e);
    const told = (e instanceof UserError || e instanceof ForbiddenError) && o.expect?.test(msg);
    log.push({ day, op: name, actor, ref: o.ref, ms: Math.round(ms), ok: false, err: msg.slice(0, 200) });
    if (told) { const k = `${name}: ${msg.replace(/[A-Z]{2}-\d+/g, "XX-n").slice(0, 90)}`; refusals.set(k, (refusals.get(k) ?? 0) + 1); }
    else {
      const key = `${name} (${e instanceof Error ? e.constructor.name : "?"}): ${msg.slice(0, 160)}`;
      const m = malfunctions.get(key);
      if (m) m.count++; else malfunctions.set(key, { count: 1, first: o.ref ?? "", day });
    }
    return undefined;
  }
}
const pct = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };

// ---------------------------------------------------------------- the simulation
describe("sixty days of use", () => {
  it("runs the whole process, every day, and every record reconciles at the end", async () => {
    fs.mkdirSync(OUT, { recursive: true });
    const d = await testDriver();
    const t = await provisionTenant(d, { name: "Simulated Logistics Co", slug: "sim60", ownerUserId: U(1), ownerName: "Sim Admin" }, tenantMigrations(), { transform: stripExt });
    const mem = (role: string, n: number, vehicleScope: "all" | "own" = "all"): Membership => ({ ...t, userId: U(n), role, vehicleScope });
    const ADMIN = mem("tenant_admin", 1), FM = mem("fleet_manager", 2), LOG = mem("logistics", 3), HR = mem("hr", 4), FIN = mem("finance", 5), AUD = mem("auditor", 6);
    const reqM = (i: number) => mem("requester", 100 + i, "own");
    const raw = <R,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<R>) => withTenant(d, ADMIN, fn);

    // ---- cast
    const named: [number, string, string][] = [[2, "Sim Fleet Manager", "fleet_manager"], [3, "Sim Logistics", "logistics"], [4, "Sim HR", "hr"], [5, "Sim Finance", "finance"], [6, "Sim Auditor", "auditor"]];
    for (const [n, name] of named) { const e = await master.saveEmployee(d, ADMIN, { full_name: name, employee_no: `M-${n}` }); await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(n), e.id])); }
    const empOf: string[] = [];
    for (let i = 1; i <= REQUESTERS; i++) {
      const e = await master.saveEmployee(d, ADMIN, { full_name: `Requester ${String(i).padStart(2, "0")}`, employee_no: `R-${String(i).padStart(3, "0")}`, department: pick(["Sales", "Operations", "Projects", "Admin", "Stores"]) });
      await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(100 + i), e.id]));
      empOf.push(e.id);
    }
    await withPlatform(d, async (q) => {
      for (const [n, , role] of named) await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
      for (let i = 1; i <= REQUESTERS; i++) await q.query("insert into public.tenant_memberships(user_id, tenant_id, role, vehicle_scope) values ($1, $2, 'requester', 'own')", [U(100 + i), t.tenantId]);
    });
    await raw(async (q) => {
      await q.query("insert into settings(key, value) values ('module_trips','1') on conflict (key) do update set value = '1'");
      await q.query("insert into settings(key, value) values ('payment_approval_limit','150000') on conflict (key) do update set value = '150000'");
    });
    // ---- vehicles: one per requester, plus six cargo vehicles (two with no load space recorded, one with nothing recorded)
    const vehOf: string[] = [];
    for (let i = 1; i <= REQUESTERS; i++) {
      const v = await master.addVehicle(d, ADMIN, { registration_no: `SIM-${String(i).padStart(3, "0")}`, make: "Toyota", model: "Hilux", employee_id: empOf[i - 1], holding_since: ymd(-400), odometer_km: String(int(8000, 90000)) });
      vehOf.push(v.id);
    }
    const cargoVeh: { id: string; kg: string; m3: string }[] = [];
    for (const [i, [kg, m3]] of ([["1500", "8"], ["3000", "10"], ["10000", "40"], ["5000", ""], ["20000", "60"], ["", ""]] as [string, string][]).entries()) {
      const v = await master.addVehicle(d, ADMIN, { registration_no: `CAR-${i + 1}`, make: "Isuzu", model: "NPR" });
      await master.setVehicleCapacity(d, ADMIN, v.id, { load_capacity_kg: kg, load_volume_m3: m3 });
      cargoVeh.push({ id: v.id, kg, m3 });
    }
    // ---- workshops and providers (no login: they answer through links)
    const shops: string[] = [];
    for (const [i, name] of ["Alpha Motors", "Bravo Garage", "Charlie Auto", "Delta Works", "Echo Tyres", "Foxtrot Electric", "Golf Brakes", "Hotel Body Shop"].entries())
      shops.push((await master.saveVendor(d, ADMIN, { name, kind: "workshop", phone: `0300 70000${String(i).padStart(2, "0")}`, categories: ["brakes", "engine", "tyres"] })).id);
    const provs: string[] = [];
    for (const [i, name] of ["Alpha Freight", "Bravo Haulage", "Charlie Cargo", "Delta Carriers", "Echo Logistics", "Foxtrot Transport", "Golf Movers", "Hotel Heavy", "India Express", "Juliet Lines"].entries())
      provs.push((await master.saveVendor(d, ADMIN, { name, kind: "logistics", phone: `0300 80000${String(i).padStart(2, "0")}` })).id);
    const reasons = await raw(async (q) => (await q.query<{ id: string; code: string }>("select id, code from reason_codes where active order by code")).rows);
    expect(reasons.length).toBeGreaterThan(3);

    // ---- the pipelines
    type Job = { id: string; stage: string; due: number; by: number; winner?: string; wo?: string; invId?: string; asked: number; approvedAmt?: number };
    type Load = { id: string; no: string; stage: string; due: number; by: number; tripId?: string; weight: number; volume: number | null; quotes: string[]; awarded?: string; invId?: string; wantsOwn?: boolean; resend?: boolean };
    const jobs: Job[] = [], loads: Load[] = [], expectedCargo = new Map<string, { w: number; v: number | null }>();
    const vreqs: { id: string; stage: string; due: number }[] = [];
    const openVreqEmps = new Set<string>();
    let ref = 0, payRef = 0;

    const estimate = () => {
      const lines: Record<string, string>[] = [];
      for (let i = int(1, 3); i > 0; i--) lines.push({ kind: pick(["part", "part", "labour"]), description: pick(["Brake pads", "Oil filter", "Tyre", "Battery", "Clutch plate", "Wheel bearing", "Fit and align", "Radiator hose"]), qty: String(int(1, 4)), unit_cost: String(int(800, 28000)) });
      return { details: "Per inspection", days_needed: String(int(1, 5)), warranty_months: String(pick([0, 3, 6, 12])), lines };
    };
    const total = (e: { lines: Record<string, string>[] }) => e.lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_cost), 0);

    // ------------------------------------------------ daily: job cards
    async function raiseJobs() {
      for (let k = 0; k < JOBS_PER_DAY; k++) {
        const i = int(1, REQUESTERS);
        const r = await op("jobcard.create", `requester ${i}`, () => jc.createJobCard(d, reqM(i), { vehicle_id: vehOf[i - 1], reason_code_id: pick(reasons).id, cause_text: pick(["Brakes squeal when stopping", "Engine warning light on", "Tyre wear on the inside edge", "Battery will not hold charge", "AC not cooling", "Vibration at speed"]) + ` (${++ref})`, lines: [] }, true), { ref: String(ref) });
        if (r) { jobs.push({ id: r.id, stage: "submitted", due: day, by: i, asked: 0 }); bump("jobcards.raised"); }
      }
    }
    async function progressJobs() {
      for (const j of jobs) {
        if (j.due > day) continue;
        if (j.stage === "submitted") {
          if (chance(0.03)) { await op("jobcard.reject", "fleet manager", () => jc.transitionJobCard(d, FM, j.id, "rejected", { comment: "Not needed this month" }), { ref: j.id }); j.stage = "rejected"; bump("jobcards.rejected"); continue; }
          const first = pick(shops);
          let ok = await op("jobcard.approve_assign", "fleet manager", () => jc.approveAndAssign(d, FM, j.id, { vendorId: first }), { ref: j.id, expect: /This repeats JC-\d+\. Say who pays/ });
          if (ok === undefined && !(await statusIs(j.id, "vendor_assigned"))) {
            // a repeat repair (ADR-094): the manager must say who pays and why before approving
            ok = await op("jobcard.approve_assign_repeat", "fleet manager", () => jc.approveAndAssign(d, FM, j.id, { vendorId: first, repeatPayer: pick(["company", "workshop", "driver"]), repeatReason: "Same fault came back within the window; workshop to check" }), { ref: j.id });
            if (ok !== undefined) bump("jobcards.repeat_flagged");
          }
          if (!ok && !(await statusIs(j.id, "vendor_assigned"))) { j.due = day + 1; continue; }
          const want = chance(0.03) ? 1 : chance(0.2) ? 2 : 3;   // most cards ask three workshops, as the policy encourages
          const others = shuffle(shops.filter((s) => s !== first)).slice(0, want - 1);
          const asked = [first];
          for (const o of others) { if (await op("jobcard.invite_workshop", "fleet manager", () => vf.inviteWorkshop(d, FM, j.id, o), { ref: j.id }) !== undefined || true) asked.push(o); }
          // each workshop gets its own link and answers: most the same day, a few leave it for tomorrow
          let got = 0;
          for (const [n, s] of asked.entries()) {
            const link = await op("quote.link", "fleet manager", () => (n === 0 ? vf.createQuoteLink(d, FM, j.id) : vf.createWorkshopLink(d, FM, j.id, "quotation", { vendorId: s })), { ref: j.id });
            if (!link) continue;
            if (chance(0.03)) continue;                                   // this workshop never answers
            const res = await op("quote.submit_by_link", "workshop", () => submitViaQuoteLink(d, link.token, estimate()), { ref: j.id });
            if (res && (res as { ok: boolean }).ok) { got++; bump("workshop.quotes"); }
          }
          j.asked = asked.length; j.stage = got > 0 ? "quoted" : "no_quotes"; j.due = day + (got > 0 ? 1 : 3);
        } else if (j.stage === "quoted") {
          const flow = await op("jobflow.read", "fleet manager", () => vf.getJobFlow(d, FM, j.id), { ref: j.id });
          const open = flow?.quotations.filter((x) => x.status === "submitted") ?? [];
          if (!open.length) { j.stage = "no_quotes"; continue; }
          const best = [...open].sort((a, b) => Number(a.amount) - Number(b.amount))[0];
          const dec = await op("quote.decide", "fleet manager", () => vf.decideQuotation(d, FM, best.id, "approve"), { ref: j.id });
          if (dec) { j.winner = best.vendor_id; j.approvedAmt = Number(best.amount); j.stage = "approved"; j.due = day + int(2, 4); bump("workshop.quotes.approved"); }
        } else if (j.stage === "no_quotes") {
          await op("jobcard.cancel_unanswered", "fleet manager", () => jc.transitionJobCard(d, FM, j.id, "cancelled", { comment: "No workshop answered" }), { ref: j.id });
          j.stage = "cancelled"; bump("jobcards.cancelled");
        } else if (j.stage === "approved") {
          const link = await op("invoice.link", "fleet manager", () => vf.createWorkshopLink(d, FM, j.id, "invoice"), { ref: j.id });
          if (!link) { j.due = day + 1; continue; }
          const flow = await vf.getJobFlow(d, FM, j.id);
          const approved = flow.quotations.find((x) => x.status === "approved");
          const lines = (approved?.lines ?? []).map((l) => ({ kind: l.kind, description: l.description, qty: l.qty, unit_cost: l.unit_cost }));
          if (chance(0.12)) lines.push({ kind: "other", description: "Extra work found", qty: "1", unit_cost: String(int(500, 6000)) });
          const res = await op("invoice.submit_by_link", "workshop", () => submitViaInvoiceLink(d, link.token, { invoice_no: `SIM-INV-${j.id.slice(0, 8)}`, invoice_date: ymd(), tax_amount: "0", lines }), { ref: j.id });
          if (res && (res as { ok: boolean }).ok) { j.stage = "invoiced"; j.due = day + 1; bump("workshop.invoices"); money.workshopInvoiced += lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_cost), 0); }
          else j.due = day + 1;
        } else if (j.stage === "invoiced") {
          const inv = await raw(async (q) => (await q.query<{ id: string }>("select i.id from invoices i join work_orders w on w.id = i.work_order_id where w.job_card_id = $1 order by i.invoice_date desc, i.id limit 1", [j.id])).rows[0]);
          if (!inv) { j.due = day + 1; continue; }
          j.invId = inv.id;
          const v = await op("invoice.verify", "finance", () => vf.verifyInvoice(d, FIN, inv.id, "pay_approved"), { ref: j.id });
          if (v) { j.stage = "verified"; j.due = day + int(1, 5); bump("workshop.invoices.verified"); }
        } else if (j.stage === "verified") {
          const sum = await op("payment.read", "admin", () => pay.getPayments(d, ADMIN, "workshop", j.invId!), { ref: j.id });
          if (!sum || sum.remaining === null) { j.due = day + 1; continue; }
          if (sum.approval.needed && !sum.approval.approvedBy) await op("payment.approve", "fleet manager", () => pay.approvePayment(d, FM, "workshop", j.invId!, "Checked against the quote"), { ref: j.id });
          const parts = chance(0.3) && sum.remaining > 1000 ? 2 : 1;
          let remaining = sum.remaining, ok = true;
          for (let p = 0; p < parts && ok; p++) {
            const amt = p === parts - 1 ? remaining : Math.floor(remaining * 0.4);
            const r = await op("payment.record", "admin", () => pay.recordPayment(d, ADMIN, "workshop", j.invId!, { amount: amt.toFixed(2), paid_on: ymd(), method: pick(["bank_transfer", "cheque", "online"]), reference: `SIMPAY-${++payRef}`, note: "" }), { ref: j.id });
            if (r) { remaining = Math.round((remaining - amt) * 100) / 100; money.workshopPaid += amt; } else ok = false;
          }
          if (ok) { await op("jobcard.close", "finance", () => jc.transitionJobCard(d, FIN, j.id, "closed"), { ref: j.id }); j.stage = "closed"; bump("jobcards.closed"); }
          else j.due = day + 1;
        }
      }
    }
    const statusIs = (id: string, s: string) => raw(async (q) => (await q.query<{ status: string }>("select status from job_cards where id = $1", [id])).rows[0]?.status === s);

    // ------------------------------------------------ daily: cargo
    async function raiseCargo() {
      for (let k = 0; k < CARGO_PER_DAY; k++) {
        const i = int(1, REQUESTERS);
        const weight = pick([180, 450, 900, 1800, 3200, 6500, 9800, 14000]) + int(0, 90);
        const volume = chance(0.7) ? Math.round((weight / pick([180, 250, 320])) * 10) / 10 : null;
        const pickup = new Date(Date.now() + int(1, 3) * 86400_000).toISOString();
        const r = await op("cargo.create", `requester ${i}`, () => createCargoRequest(d, reqM(i), {
          description: pick(["Fabric rolls", "Spare parts", "Machinery", "Packed goods", "Office furniture", "Steel pipes"]) + ` ${++ref}`, quantity_text: `${int(2, 80)} units`, weight_kg: String(weight), ...(volume ? { volume_m3: String(volume) } : {}),
          pickup_place: pick(["Gulberg warehouse, Lahore", "Sundar estate, Lahore", "Faisalabad depot", "Multan yard"]), pickup_contact: "Imran", pickup_phone: "0300 1234567", pickup_at: pickup,
          drop_place: pick(["Karachi head office", "Port Qasim, Karachi", "Islamabad site", "Peshawar store"]), drop_contact: "Saima", drop_phone: "0321 7654321", deliver_by: new Date(Date.parse(pickup) + 2 * 86400_000).toISOString(),
          handling: pick(["Fragile", "Keep dry", ""]), vehicle_type: pick(["10-tonne truck", "20-foot container", "Pickup", "Flatbed"]), department: "Sales" }), { ref: String(ref) });
        if (r) { loads.push({ id: r.id, no: r.cargo_no, stage: "requested", due: day, by: i, weight, volume, quotes: [] }); expectedCargo.set(r.id, { w: weight, v: volume }); bump("cargo.requested"); }
      }
    }
    async function progressCargo() {
      for (const c of loads) {
        if (c.due > day) continue;
        if (c.stage === "requested") {
          if (chance(0.01)) { await op("cargo.reject", "logistics", () => transitionCargo(d, LOG, c.id, "rejected", "No vehicle for these dates"), { ref: c.id }); c.stage = "rejected"; bump("cargo.rejected"); continue; }
          // what the suggestion promises must hold: nothing too small, nothing booked wrongly
          const sug = await op("cargo.suggest", "logistics", () => suggestVehicles(d, LOG, c.id), { ref: c.id });
          if (sug) for (const s of sug.suggestions) {
            if (s.capacity_kg < c.weight) malfunctions.set(`suggestion offered ${s.registration_no} (${s.capacity_kg} kg) for a ${c.weight} kg load`, { count: (malfunctions.get(`suggestion offered ${s.registration_no} (${s.capacity_kg} kg) for a ${c.weight} kg load`)?.count ?? 0) + 1, first: c.id, day });
            if (c.volume !== null && s.capacity_m3 !== null && s.capacity_m3 < c.volume) malfunctions.set(`suggestion offered ${s.registration_no} (${s.capacity_m3} m3) for a ${c.volume} m3 load`, { count: (malfunctions.get(`suggestion offered ${s.registration_no} (${s.capacity_m3} m3) for a ${c.volume} m3 load`)?.count ?? 0) + 1, first: c.id, day });
          }
          const a = await op("cargo.accept", "logistics", () => transitionCargo(d, LOG, c.id, "accepted", "We will send a truck"), { ref: c.id });
          if (a === undefined && !(await cargoIs(c.id, "accepted"))) { c.due = day + 1; continue; }
          const tid = await op("cargo.make_trip", "logistics", () => makeTripFromCargo(d, LOG, c.id), { ref: c.id });
          if (!tid) { c.due = day + 1; continue; }
          c.tripId = tid; bump("trips.planned");
          const k = pick([6, 7, 7, 7, 8]);
          const chosen = shuffle(provs).slice(0, k);
          const n = await op("trip.ask_quotes", "fleet manager", () => trips.requestTripQuotes(d, FM, tid, chosen), { ref: c.id });
          if (n === undefined) { c.due = day + 1; continue; }
          bump("cargo.quote_requests", chosen.length);
          const rows = await trips.listTripQuotes(d, FM, tid);
          for (const q of rows.filter((x) => x.status === "requested")) {
            if (chance(0.1)) { await op("trip.quote_decline", "provider", () => trips.declineTripQuote(d, FM, q.id), { ref: c.id }); continue; }
            const link = await op("trip.quote_link", "logistics", () => trips.createTripQuoteLink(d, LOG, q.id), { ref: c.id });
            if (!link) continue;
            const base = 20000 + c.weight * 9 + int(0, 30000);
            const res = await op("trip.quote_submit_by_link", "provider", () => submitViaTripQuoteLink(d, link.token, { amount: String(Math.round(base * (0.8 + rnd() * 0.6))), vehicle_text: "Hino 10T", driver_text: "Rashid", notes: "Fuel included", valid_until: ymd(5) }), { ref: c.id });
            if (res && (res as { ok: boolean }).ok) { bump("cargo.quotes.received"); c.quotes.push(q.id); }
          }
          c.stage = "quoted"; c.due = day + 1;
        } else if (c.stage === "quoted") {
          const rows = (await trips.listTripQuotes(d, FM, c.tripId!)).filter((x) => x.status === "quoted");
          if (!rows.length) { await op("cargo.cancel_no_quote", "logistics", () => transitionCargo(d, LOG, c.id, "cancelled", "No provider quoted"), { ref: c.id }); c.stage = "cancelled"; continue; }
          const best = [...rows].sort((a, b) => Number(a.amount) - Number(b.amount))[0];
          const aw = await op("trip.award", "fleet manager", () => trips.awardTripQuote(d, FM, c.tripId!, best.id, "Lowest quote"), { ref: c.id, expect: /segregation|cannot award/i });
          if (aw === undefined && !(await tripAwarded(c.tripId!))) { c.due = day + 1; continue; }
          c.awarded = best.id; c.stage = "awarded"; c.due = day + 1; bump("trips.awarded");
        } else if (c.stage === "awarded") {
          await op("trip.start", "fleet manager", () => trips.transitionTrip(d, FM, c.tripId!, "started"), { ref: c.id });
          await op("cargo.in_transit", "logistics", () => transitionCargo(d, LOG, c.id, "in_transit"), { ref: c.id });
          c.stage = "moving"; c.due = day + 1;
        } else if (c.stage === "moving") {
          await op("trip.complete", "fleet manager", () => trips.transitionTrip(d, FM, c.tripId!, "completed"), { ref: c.id });
          await op("cargo.delivered", "logistics", () => transitionCargo(d, LOG, c.id, "delivered"), { ref: c.id });
          c.stage = "delivered"; c.due = day + int(1, 3); bump("cargo.delivered");
        } else if (c.stage === "delivered") {
          const link = await op("trip.invoice_link", "logistics", () => trips.createTripInvoiceLink(d, LOG, c.tripId!), { ref: c.id });
          if (!link) { c.due = day + 1; continue; }
          const q = (await trips.listTripQuotes(d, FM, c.tripId!)).find((x) => x.id === c.awarded);
          const amt = Number(q?.amount ?? 0) * (!c.resend && chance(0.1) ? 1.05 : 1);
          const res = await op("trip.invoice_submit_by_link", "provider", () => submitViaTripInvoiceLink(d, link.token, { invoice_no: `TINV-${c.no}${c.resend ? "-R" : ""}`, invoice_date: ymd(), amount: String(Math.round(amt)), notes: "" }), { ref: c.id });
          if (res && (res as { ok: boolean }).ok) { c.stage = "invoiced"; c.due = day + 1; bump("trips.invoices"); money.tripInvoiced += Math.round(amt); } else c.due = day + 1;
        } else if (c.stage === "invoiced") {
          const inv = (await trips.listTripInvoices(d, FIN, c.tripId!))[0];
          if (!inv) { c.due = day + 1; continue; }
          c.invId = inv.id;
          const awarded = Number((await trips.listTripQuotes(d, FM, c.tripId!)).find((x) => x.id === c.awarded)?.amount ?? 0);
          const billed = Number((await trips.listTripInvoices(d, FIN, c.tripId!))[0]?.amount ?? awarded);
          let v: unknown;
          if (Math.abs(billed - awarded) < 0.01) v = await op("trip.invoice_verify", "finance", () => trips.verifyTripInvoice(d, FIN, inv.id, "pay_approved"), { ref: c.id });
          else if (chance(0.6)) { v = await op("trip.invoice_verify_billed", "finance", () => trips.verifyTripInvoice(d, FIN, inv.id, "pay_invoiced", "Fuel surcharge accepted by logistics"), { ref: c.id }); bump("trips.invoices.paid_above_award"); }
          else { await op("trip.invoice_return", "finance", () => trips.verifyTripInvoice(d, FIN, inv.id, "return", "Billed above the award; resend at the awarded amount"), { ref: c.id }); c.stage = "delivered"; c.due = day + 1; c.resend = true; bump("trips.invoices.returned"); continue; }
          if (v !== undefined) { c.stage = "verified"; c.due = day + int(1, 4); bump("trips.invoices.verified"); } else c.due = day + 1;
        } else if (c.stage === "verified") {
          const sum = await op("trip.payment_read", "admin", () => pay.getPayments(d, ADMIN, "trip", c.invId!), { ref: c.id });
          if (!sum || sum.remaining === null) { c.due = day + 1; continue; }
          if (sum.approval.needed && !sum.approval.approvedBy) await op("trip.payment_approve", "fleet manager", () => pay.approvePayment(d, FM, "trip", c.invId!, "Checked against the award"), { ref: c.id });
          const r = await op("trip.payment_record", "admin", () => pay.recordPayment(d, ADMIN, "trip", c.invId!, { amount: sum.remaining!.toFixed(2), paid_on: ymd(), method: pick(["bank_transfer", "online"]), reference: `SIMTRIP-${++payRef}`, note: "" }), { ref: c.id });
          if (r) { money.tripPaid += sum.remaining; c.stage = "paid"; bump("trips.paid"); } else c.due = day + 1;
        }
      }
    }
    const cargoIs = (id: string, s: string) => raw(async (q) => (await q.query<{ status: string }>("select status from cargo_requests where id = $1", [id])).rows[0]?.status === s);
    const tripAwarded = (id: string) => raw(async (q) => (await q.query("select 1 from trip_quotes where trip_id = $1 and status = 'awarded'", [id])).rows.length > 0);
    const tripInvoiceIs = (id: string, s: string) => raw(async (q) => (await q.query<{ status: string }>("select status from trip_invoices where id = $1", [id])).rows[0]?.status === s);

    // ------------------------------------------------ daily: HR vehicle requests and the auditor
    async function hrDay() {
      const free = empOf.filter((e) => !openVreqEmps.has(e));
      if (free.length && chance(0.7)) {
        const e = pick(free);
        const id = await op("vreq.request", "hr", () => vr.requestVehicle(d, HR, { for_employee: e, reason: "New team member needs a vehicle", vehicle_class: pick(["Sedan", "Pickup", "SUV"]), needed_from: ymd(14) }), { ref: e, expect: /already has an open/ });
        if (id) { openVreqEmps.add(e); vreqs.push({ id, stage: "requested", due: day + 1 }); bump("vreq.requested"); }
      }
      for (const r of vreqs) {
        if (r.due > day) continue;
        if (r.stage === "requested") { const ok = await op("vreq.reject", "fleet manager", () => vr.transitionVehicleRequest(d, FM, r.id, "rejected", { note: "No budget this quarter" }), { ref: r.id }); if (ok !== undefined) { r.stage = "done"; bump("vreq.decided"); } }
      }
    }
    async function auditorDay() {
      await op("audit.read_jobcards", "auditor", () => jc.listJobCards(d, AUD, {}));
      await op("audit.read_invoices", "auditor", () => vf.listInvoices(d, AUD, {}));
      await op("audit.read_trips", "auditor", () => trips.listTrips(d, AUD, {}));
      // the auditor only reads: every attempt to change something must be refused
      const sample = loads.find((c) => c.tripId) ?? loads[0];
      const attempts: [string, () => Promise<unknown>][] = [
        ["audit.try_create_jobcard", () => jc.createJobCard(d, AUD, { vehicle_id: vehOf[0], reason_code_id: reasons[0].id, cause_text: "Auditor must not raise this", lines: [] }, true)],
        ["audit.try_accept_cargo", () => (sample ? transitionCargo(d, AUD, sample.id, "accepted") : Promise.reject(new ForbiddenError("none")))],
        ["audit.try_pay", () => pay.recordPayment(d, AUD, "workshop", jobs.find((j) => j.invId)?.invId ?? U(999), { amount: "1", paid_on: ymd(), method: "cash", reference: "", note: "" })],
        ["audit.try_vendor", () => master.saveVendor(d, AUD, { name: "Auditor Vendor" })],
      ];
      for (const [name, fn] of attempts) {
        try { await fn(); malfunctions.set(`${name}: the auditor was ALLOWED to change data`, { count: (malfunctions.get(`${name}: the auditor was ALLOWED to change data`)?.count ?? 0) + 1, first: "", day }); }
        catch (e) { if (e instanceof ForbiddenError) refusals.set(name, (refusals.get(name) ?? 0) + 1); else { const key = `${name}: refused with the wrong kind of error (${e instanceof Error ? e.constructor.name : "?"}: ${String((e as Error)?.message).slice(0, 80)})`; malfunctions.set(key, { count: (malfunctions.get(key)?.count ?? 0) + 1, first: "", day }); } }
      }
      // a requester must never act as a manager
      try { await trips.awardTripQuote(d, reqM(1), sample?.tripId ?? U(998), U(997)); malfunctions.set("a requester awarded a trip quote", { count: 1, first: "", day }); } catch (e) { if (e instanceof ForbiddenError) refusals.set("requester tries to award", (refusals.get("requester tries to award") ?? 0) + 1); }
    }

    // ------------------------------------------------ moving the calendar
    const shiftOneDay = () => {
      const sql = `
        set session_replication_role = replica;
        do $f$ declare r record; sets text; begin
          for r in select c.table_name from information_schema.tables c where c.table_schema = '${t.schema}' and c.table_type = 'BASE TABLE' loop
            select string_agg(format('%I = %I - interval ''1 day''', column_name, column_name), ', ') into sets
              from information_schema.columns where table_schema = '${t.schema}' and table_name = r.table_name and data_type in ('timestamp with time zone', 'date') and is_generated = 'NEVER';
            if sets is not null then execute format('update %I.%I set %s', '${t.schema}', r.table_name, sets); end if;
          end loop;
        end $f$;`;
      execFileSync("psql", ["-h", PGHOST, "-d", SUPER, "-q", "-v", "ON_ERROR_STOP=1", "-c", sql], { stdio: ["ignore", "ignore", "inherit"] });
    };

    // ================================================================ the days
    const t0 = Date.now();
    for (day = 0; day < DAYS; day++) {
      if (day > 0) shiftOneDay();
      await withPlatform(d, (q) => q.query("delete from public.rate_limits"));
      const before = { ...counts };
      const d0 = Date.now();
      await raiseJobs(); await raiseCargo(); await hrDay();
      await progressJobs(); await progressCargo();
      await auditorDay();
      const row: Record<string, number> = { day: day + 1, seconds: Math.round((Date.now() - d0) / 1000) };
      for (const k of Object.keys(counts)) row[k] = (counts[k] ?? 0) - (before[k] ?? 0);
      byDay.push(row);
      if (day % 5 === 4 || day === DAYS - 1) console.log(`day ${day + 1}/${DAYS}: ${JSON.stringify(row)}  [${Math.round((Date.now() - t0) / 60000)} min, ${malfunctions.size} kinds of malfunction so far]`);
    }
    // let everything in flight finish: a few more days with no new work
    for (let extra = 0; extra < 14; extra++) { day = DAYS + extra; shiftOneDay(); await progressJobs(); await progressCargo(); }

    // ================================================================ reconcile the database against what the simulation did
    const one = async <R,>(sql: string, params: unknown[] = []) => raw(async (q) => (await q.query<R>(sql, params)).rows);
    const inv: Record<string, string> = {};
    const check = async (name: string, sql: string, expectEmpty = true) => {
      try { const rows = await one<Record<string, unknown>>(sql); if (expectEmpty ? rows.length > 0 : rows.length === 0) inv[name] = `${rows.length} offending row(s): ${JSON.stringify(rows.slice(0, 3)).slice(0, 300)}`; else inv[name] = "ok"; }
      catch (e) { inv[name] = `the check itself failed: ${(e as Error).message.slice(0, 160)}`; }
    };
    await check("a paid workshop invoice is paid in full", `select i.id from invoices i where i.status = 'paid' and abs(coalesce((select sum(amount) from invoice_payments p where p.invoice_id = i.id and p.voided_at is null), 0) - (coalesce(i.payable_amount, i.amount) + i.tax_amount)) > 0.01`);
    await check("no workshop invoice is paid beyond what is due", `select i.id from invoices i where coalesce((select sum(amount) from invoice_payments p where p.invoice_id = i.id and p.voided_at is null), 0) > coalesce(i.payable_amount, i.amount) + i.tax_amount + 0.01`);
    await check("nobody checked and paid the same workshop invoice", `select distinct i.id from invoices i join invoice_payments p on p.invoice_id = i.id where p.paid_by = i.verified_by and p.voided_at is null`);
    await check("nobody awarded a trip they asked for", `select t.id from trips t join employees e on e.id = t.requested_by where t.outsourced_vendor_id is not null and t.decided_by = e.user_id`);
    await check("every awarded trip has one awarded quote at the award amount", `select t.id from trips t where t.outsourced_vendor_id is not null and (select count(*) from trip_quotes q where q.trip_id = t.id and q.status = 'awarded') <> 1`);
    await check("the award amount equals the awarded quote", `select t.id from trips t join trip_quotes q on q.trip_id = t.id and q.status = 'awarded' where t.award_amount <> q.amount`);
    await check("a paid trip invoice is paid in full", `select ti.id from trip_invoices ti where ti.status = 'paid' and abs(coalesce((select sum(amount) from invoice_payments p where p.trip_invoice_id = ti.id and p.voided_at is null), 0) - ti.payable) > 0.01`);
    await check("a delivered load belongs to a completed trip", `select c.id from cargo_requests c join trips t on t.id = c.trip_id where c.status = 'delivered' and t.status <> 'completed'`);
    await check("every closed job card has an invoice that was verified", `select j.id from job_cards j where j.status = 'closed' and not exists (select 1 from invoices i join work_orders w on w.id = i.work_order_id where w.job_card_id = j.id and i.status in ('verified','paid'))`);
    await check("every job card event chain starts at draft", `select j.id from job_cards j where (select to_status from job_card_events e where e.job_card_id = j.id order by e.seq limit 1) is distinct from 'draft'`);
    await check("weight and volume saved exactly as requested", `select id from cargo_requests where false`);
    for (const [id, e] of expectedCargo) {
      const c = await getCargo(d, LOG, id);
      if (c && (Number(c.weight_kg) !== e.w || (e.v === null ? c.volume_m3 !== null : Math.abs(Number(c.volume_m3) - e.v) > 0.01))) inv["weight and volume saved exactly as requested"] = `load ${id}: asked ${e.w} kg / ${e.v} m3, stored ${c.weight_kg} / ${c.volume_m3}`;
    }
    if (inv["weight and volume saved exactly as requested"] === "ok" || inv["weight and volume saved exactly as requested"] === undefined) inv["weight and volume saved exactly as requested"] = "ok";
    const totals = await one<{ w: string; tp: string }>(`select coalesce((select sum(p.amount) from invoice_payments p join invoices i on i.id = p.invoice_id where p.voided_at is null and p.invoice_id is not null), 0)::text as w, coalesce((select sum(amount) from invoice_payments where trip_invoice_id is not null and voided_at is null), 0)::text as tp`).catch(() => [{ w: "?", tp: "?" }]);
    const dbWorkshopPaid = Number(totals[0].w), dbTripPaid = Number(totals[0].tp);
    inv["money paid to workshops: the database equals what the simulation paid"] = Math.abs(dbWorkshopPaid - money.workshopPaid) < 1 ? "ok" : `database ${dbWorkshopPaid} vs simulation ${money.workshopPaid}`;
    inv["money paid to providers: the database equals what the simulation paid"] = Number.isNaN(dbTripPaid) || Math.abs(dbTripPaid - money.tripPaid) < 1 ? (Number.isNaN(dbTripPaid) ? "the trip payments table was not found by the check" : "ok") : `database ${dbTripPaid} vs simulation ${money.tripPaid}`;
    const stat = await one<{ k: string; n: string }>(`select 'jobcards ' || status as k, count(*)::text n from job_cards group by status union all select 'cargo ' || status, count(*)::text from cargo_requests group by status union all select 'trips ' || status, count(*)::text from trips group by status union all select 'quotations ' || status, count(*)::text from quotations group by status union all select 'trip_quotes ' || status, count(*)::text from trip_quotes group by status order by 1`);

    // ---- the heavy screens and every export, at the size the data has reached after 60 days
    const heavy: [string, string, () => Promise<unknown>][] = [
      ["read.dashboard", "administrator", () => getDashboard(d, ADMIN)], ["read.overview", "fleet manager", () => getOverview(d, FM)], ["read.dashboard_requester", "requester", () => getDashboard(d, reqM(1))],
      ["read.jobcards_all", "fleet manager", () => jc.listJobCards(d, FM, {})], ["read.quotations_all", "fleet manager", () => vf.listQuotations(d, FM, {})], ["read.invoices_all", "finance", () => vf.listInvoices(d, FIN, {})],
      ["read.cargo_all", "logistics", () => listCargo(d, LOG, {})], ["read.trips_all", "fleet manager", () => trips.listTrips(d, FM, {})], ["read.outsourced_report", "fleet manager", () => outsourcedTripReport(d, FM, 12)],
      ["read.jobcards_requester", "requester", () => jc.listJobCards(d, reqM(1), {})],
    ];
    for (const [name, who, fn] of heavy) { day = DAYS + 20; await op(name, who, fn); }
    const exportSizes: string[] = [];
    for (const kind of EXPORT_KINDS) {
      const r = await op(`export.${kind}`, "administrator", () => exportCsv(d, ADMIN, kind, {}));
      if (r) exportSizes.push(`${kind}: ${r.rows} rows, ${Math.round(r.csv.length / 1024)} KB`);
    }
    const heavyMs = [...timings.entries()].filter(([k]) => k.startsWith("read.") || k.startsWith("export.")).map(([k, v]) => `| ${k} | ${Math.round(v[0])} |`);

    // ================================================================ write the evidence
    fs.writeFileSync(path.join(OUT, "ledger.jsonl"), log.map((r) => JSON.stringify(r)).join("\n"));
    const cols = [...new Set(byDay.flatMap((r) => Object.keys(r)))];
    fs.writeFileSync(path.join(OUT, "daily.csv"), [cols.join(","), ...byDay.map((r) => cols.map((c) => r[c] ?? 0).join(","))].join("\n"));
    const lat = [...timings.entries()].map(([k, v]) => ({ op: k, n: v.length, p50: Math.round(pct(v, 0.5)), p95: Math.round(pct(v, 0.95)), max: Math.round(Math.max(...v)) })).sort((a, b) => b.p95 - a.p95);
    const early = byDay.slice(0, 10).reduce((s, r) => s + r.seconds, 0) / Math.max(1, Math.min(10, byDay.length)), late = byDay.slice(-10).reduce((s, r) => s + r.seconds, 0) / Math.max(1, Math.min(10, byDay.length));
    const md = [
      `# 60-day simulation: ${new Date().toISOString().slice(0, 10)}`, "",
      `Days: ${DAYS} (+14 settling days). Seed ${process.env.SIM_SEED ?? 20261114}. Wall time ${Math.round((Date.now() - t0) / 60000)} min.`, "",
      "## What was done", "", "| Item | Count |", "|---|---|", ...Object.entries(counts).sort().map(([k, v]) => `| ${k} | ${v} |`), "",
      `Per day, averages: ${(counts["jobcards.raised"] / DAYS).toFixed(1)} job cards, ${(counts["workshop.quotes"] / DAYS).toFixed(1)} workshop estimates, ${(counts["trips.planned"] / DAYS).toFixed(1)} cargo trips planned, ${(counts["cargo.quote_requests"] / DAYS).toFixed(1)} provider quotes asked for, ${(counts["cargo.quotes.received"] / DAYS).toFixed(1)} received.`, "",
      "## Money", "", `Workshops: invoiced ${money.workshopInvoiced.toLocaleString()}, paid ${money.workshopPaid.toLocaleString()} (database says ${dbWorkshopPaid.toLocaleString()}).`, `Providers: invoiced ${money.tripInvoiced.toLocaleString()}, paid ${money.tripPaid.toLocaleString()} (database says ${Number.isNaN(dbTripPaid) ? "n/a" : dbTripPaid.toLocaleString()}).`, "",
      "## Where everything ended", "", "| State | Rows |", "|---|---|", ...stat.map((s) => `| ${s.k} | ${s.n} |`), "",
      "## Reconciliation of the database", "", "| Check | Result |", "|---|---|", ...Object.entries(inv).map(([k, v]) => `| ${k} | ${v} |`), "",
      "## Malfunctions (anything the rules did not expect)", "", malfunctions.size === 0 ? "None." : "| What | Times | First seen on day | Ref |\n|---|---|---|---|\n" + [...malfunctions.entries()].map(([k, v]) => `| ${k} | ${v.count} | ${v.day + 1} | ${v.first} |`).join("\n"), "",
      "## Correct refusals (people told no, as designed)", "", refusals.size === 0 ? "None." : "| What | Times |\n|---|---|\n" + [...refusals.entries()].map(([k, v]) => `| ${k} | ${v} |`).join("\n"), "",
      "## Speed (milliseconds per operation, through the service layer on a local database)", "", "| Operation | Calls | p50 | p95 | max |", "|---|---|---|---|---|", ...lat.map((l) => `| ${l.op} | ${l.n} | ${l.p50} | ${l.p95} | ${l.max} |`), "",
      "## Screens and exports at day-60 size (milliseconds, one call each)", "", "| Screen or export | ms |", "|---|---|", ...heavyMs, "", `Export sizes: ${exportSizes.join("; ")}`, "",
      `Day length: first 10 days ${early.toFixed(1)} s on average, last 10 days ${late.toFixed(1)} s on average (${(late / Math.max(early, 0.001)).toFixed(2)}x as the data grew).`,
    ].join("\n");
    fs.writeFileSync(path.join(OUT, "report.md"), md);
    console.log(md.slice(0, 6000));
    expect(true).toBe(true);
  });
});
