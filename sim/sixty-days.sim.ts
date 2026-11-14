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
import { processWhatsAppMenu } from "@/lib/wa-menu/engine";
import { setWaMenu } from "@/lib/wa-menu/switch";
import { processWhatsAppJobCard, setWaJobCards, type IntakeDeps } from "@/lib/wa-jobcards/service";
import { readEmailDocument } from "@/lib/ai/service";
import { setAiDocuments } from "@/lib/ai/service";
import type { CreateMessage } from "@/lib/ai/claude";
import { recommendTripQuotes } from "@/lib/trips/advice";
import { enterForWorkshop } from "@/lib/vendorflow/entry";
import { processInboundEmail, replyAddress, type InboundDeps } from "@/lib/vendorflow/inbound";
import * as odo from "@/lib/odometer/service";
import { submitViaLink } from "@/lib/odometer/link";
import * as comp from "@/lib/compliance/service";
import { runDocumentReminders } from "@/lib/compliance/reminders";
import { runOdometerWhatsApp } from "@/lib/odometer/whatsapp";
import { notifyWorkshop } from "@/lib/vendorflow/whatsapp-notify";
import type { InboundMessage } from "@/lib/whatsapp";
import type { ReadableStore } from "@/lib/master/policy-reading";
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
vi.mock("@/lib/billing/plans", async (orig) => ({ ...(await orig<typeof import("@/lib/billing/plans")>()), tenantPlan: async () => ({ outsourcedTrips: plan.pro, fleetOps: true, aiDocuments: true, whatsappMenu: true, aiTrialReads: null, aiPerDay: 100000 }) }));

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
    const EMAIL_FILE = path.resolve(OUT, "email.jsonl"), WA_FILE = path.resolve(OUT, "whatsapp.jsonl");
    for (const f of [EMAIL_FILE, WA_FILE]) fs.rmSync(f, { force: true });
    Object.assign(process.env, { ALLOW_FILE_MAILER: "1", SMTP_URL: `file:${EMAIL_FILE}`, EMAIL_FROM: "Fleet OTG <noreply@sim.test>", WHATSAPP_FILE: WA_FILE, WHATSAPP_PHONE_NUMBER_ID: "100200300", WHATSAPP_ACCESS_TOKEN: "sim-token",
      ANTHROPIC_API_KEY: "sk-ant-sim-fake", INBOUND_REPLY_DOMAIN: "reply.sim.test", RESEND_API_KEY: "re_sim_key",
      RESEND_WEBHOOK_SECRET: "whsec_" + Buffer.from("a-sim-secret-of-some-length-1234567").toString("base64"), WHATSAPP_ODOMETER_TEMPLATE: "odo_request",
      WHATSAPP_ESTIMATE_APPROVED_TEMPLATE: "est_ok", WHATSAPP_ESTIMATE_DECLINED_TEMPLATE: "est_no", WHATSAPP_INVOICE_ACCEPTED_TEMPLATE: "inv_ok", WHATSAPP_INVOICE_QUERIED_TEMPLATE: "inv_q" });
    const outLines = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean) : []);
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
    const phoneOfEmp = (n: number) => `0300 51${String(n).padStart(5, "0")}`;           // requesters 1..50, main agents 51..
    const waFrom = (n: number) => `+92300 51${String(n).padStart(5, "0")}`.replace(" ", "");
    const MAIN = [[2, "fleet.manager"], [3, "logistics"], [4, "hr"], [5, "finance"], [6, "auditor"]] as const;
    await raw(async (q) => {
      for (let i = 1; i <= REQUESTERS; i++) await q.query("update employees set phone = $2, email = $3 where id = $1", [empOf[i - 1], phoneOfEmp(i), `requester${i}@sim.example`]);
      for (const [n, nm] of MAIN) await q.query("update employees set phone = $2, email = $3 where user_id = $1", [U(n), phoneOfEmp(50 + n), `${nm}@sim.example`]);
    });
    await setWaMenu(d, ADMIN, true); await setAiDocuments(d, ADMIN, true); await setWaJobCards(d, ADMIN, true);
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
      shops.push((await master.saveVendor(d, ADMIN, { name, kind: "workshop", phone: `0300 70000${String(i).padStart(2, "0")}`, email: `shop${i}@sim.example`, categories: ["brakes", "engine", "tyres"] })).id);
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
    const challans: { id: string; due: number; done?: boolean }[] = [];
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
      for (let k = 0; k < JOBS_PER_DAY - 7; k++) {          // 4 more arrive by the WhatsApp menu and 3 by a free-text message the AI drafts
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
            if (n === 0 && chance(0.15)) { const est = estimate(); if (await estimateByEmail(j.id, shops.indexOf(s), est)) { got++; bump("workshop.quotes"); } continue; }
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
          if (dec) { await tellWorkshops(j.id, best.vendor_id, open.map((x) => x.vendor_id).filter((v) => v !== best.vendor_id)); }
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
          if (v) { j.stage = "verified"; j.due = day + int(1, 5); bump("workshop.invoices.verified"); const c0 = await vf.workshopContact(d, FM, j.id).catch(() => null); const dl = await notifyWorkshop("invoice_accepted", c0, "Simulated Logistics Co"); bump(`whatsapp.workshop_notice_${dl}`); }
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
      for (let k = 0; k < CARGO_PER_DAY - 8; k++) {          // 8 more arrive by the WhatsApp menu
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
          if (chance(0.15)) await adviseTrip(c);
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


    // ================================================================ the rest of the product: papers, reminders, odometer, accidents, challans, WhatsApp, AI, email
    const allVeh = [...vehOf, ...cargoVeh.map((c) => c.id)];
    const plateOf = new Map<string, string>(), holderOf = new Map<string, number>();
    for (const [i, id] of vehOf.entries()) { plateOf.set(id, `SIM-${String(i + 1).padStart(3, "0")}`); holderOf.set(id, i + 1); }
    for (const [i, c] of cargoVeh.entries()) plateOf.set(c.id, `CAR-${i + 1}`);
    const kmNow = new Map<string, number>();
    for (const id of allVeh) kmNow.set(id, Number((await raw(async (q) => (await q.query<{ k: string }>("select odometer_km::text k from vehicles where id = $1", [id])).rows[0])).k));
    const currentKm = async (id: string) => Number((await raw(async (q) => (await q.query<{ k: string }>("select odometer_km::text k from vehicles where id = $1", [id])).rows[0])).k);
    const waNo = (i: number) => `+92300${"51"}${String(i).padStart(5, "0")}`;

    // ---- papers: three for every vehicle, expiring from 10 days ago to 150 days ahead; the calendar then runs through them
    for (const id of allVeh) {
      for (const type of ["insurance", "registration", "fitness"] as const) {
        const exp = ymd(int(-10, 150));
        await op("paper.add", "fleet manager", () => comp.addDocument(d, FM, { vehicle_id: id, doc_type: type, reference: `${type.slice(0, 3).toUpperCase()}-${plateOf.get(id)}`, issued_by: type === "insurance" ? "Jubilee General" : "Excise & Taxation", valid_from: ymd(-365), expires_on: exp, amount: String(int(3000, 60000)) }));
        bump("papers.added");
      }
    }

    // ---- one chat with the WhatsApp menu: says Hi, picks the flow, and answers each question by what it asks; a question it does not know is recorded
    let wamid = 0;
    const wsay = async (from: string, text: string) => (await processWhatsAppMenu(d, { id: `wamid.m${++wamid}`, from, contextId: null, text, media: [] } as InboundMessage)).reply ?? "";
    async function chat(name: string, from: string, label: string, rules: [RegExp, () => string][], done: RegExp): Promise<string | undefined> {
      const t0c = performance.now();
      let reply = await wsay(from, "Hi");
      const n = new RegExp(`(\\d)\\. ${label}`).exec(reply)?.[1];
      if (!n) { malfunctions.set(`${name}: the menu did not offer "${label}": ${reply.slice(0, 120)}`, { count: (malfunctions.get(`${name}: the menu did not offer "${label}": ${reply.slice(0, 120)}`)?.count ?? 0) + 1, first: from, day }); return undefined; }
      if (process.env.SIM_DEBUG_CHAT === name) fs.appendFileSync(path.join(OUT, "chat-debug.log"), `[${name}] menu: ${reply.replace(/\s+/g, " ").slice(0, 300)}\n`);
      reply = await wsay(from, n);
      for (let step = 0; step < 40; step++) {
        if (done.test(reply)) { (timings.get(name) ?? timings.set(name, []).get(name)!).push(performance.now() - t0c); return reply; }
        const rule = rules.find(([re]) => re.test(reply));
        if (!rule) { const k = `${name}: the chat asked something the simulation had no answer for: ${reply.slice(0, 140).replace(/\s+/g, " ")}`; malfunctions.set(k, { count: (malfunctions.get(k)?.count ?? 0) + 1, first: from, day }); await wsay(from, "cancel"); return undefined; }
        if (process.env.SIM_DEBUG_CHAT === name) fs.appendFileSync(path.join(OUT, "chat-debug.log"), `[${name}] <- ${reply.replace(/\s+/g, " ").slice(0, 300)}\n`);
        reply = await wsay(from, rule[1]());
      }
      malfunctions.set(`${name}: the chat did not finish in 40 steps`, { count: 1, first: from, day });
      return undefined;
    }

    async function whatsappCargo(i: number) {
      const weight = pick([200, 800, 2400, 7000, 12000]) + int(0, 50), volume = chance(0.6) ? Math.round((weight / 250) * 10) / 10 : null;
      const reply = await chat("whatsapp.cargo_chat", waNo(i), "Schedule Cargo Pick-up and Delivery", [
        [/Your record says .*Reply 1 to use it/i, () => "1"], [/Which department is this request for/i, () => "Sales"], [/When do you need the vehicle/i, () => "tomorrow 10am"],
        [/Pick-up location/i, () => "Gulberg warehouse, Lahore"], [/Destination/i, () => "Karachi head office"], [/Which type of vehicle is required/i, () => "10-tonne truck"],
        [/Inventory or material load details/i, () => `Chat load ${++ref}`], [/Quantity of the load/i, () => `${int(2, 60)} cartons`], [/Total weight of the load in kilograms/i, () => String(weight)],
        [/Volume of the load in cubic metres/i, () => (volume === null ? "skip" : String(volume))], [/Person or persons to contact/i, () => "Ali 0300 1234567"], [/special instructions/i, () => "skip"],
        [/Department:|Reply YES|\byes\b/i, () => "yes"],
      ], /Done\. Cargo request (CR-\d+)/);
      const no = reply && /(CR-\d+)/.exec(reply)?.[1];
      if (no) {
        const row = await raw(async (q) => (await q.query<{ id: string }>("select id from cargo_requests where cargo_no = $1", [no])).rows[0]);
        if (row) { loads.push({ id: row.id, no, stage: "requested", due: day, by: i, weight, volume, quotes: [] }); expectedCargo.set(row.id, { w: weight, v: volume }); bump("cargo.requested"); bump("cargo.requested_by_whatsapp"); }
      }
    }
    async function whatsappJobCard(i: number) {
      const base = await currentKm(vehOf[i - 1]);
      const reply = await chat("whatsapp.jobcard_chat", waNo(i), "Submit a Job Card", [
        [/Which vehicle\?/i, () => "1"], [/What kind of work is it\?/i, () => "2"], [/explain the problem or the work needed/i, () => "Front left brake grinds when stopping, noticed this week"],
        [/odometer show on/i, () => String(base + int(10, 400))], [/How urgent is it\?/i, () => "2"], [/By when is it needed/i, () => "skip"], [/Send up to 3 photos/i, () => "done"],
        [/Reply YES|\byes\b/i, () => "yes"],
      ], /(JC-\d+)[\s\S]*(sent|raised|Done)|Done\.[\s\S]*(JC-\d+)/i);
      const no = reply && /(JC-\d+)/.exec(reply)?.[1];
      if (no) {
        const row = await raw(async (q) => (await q.query<{ id: string }>("select id from job_cards where job_no = $1", [no])).rows[0]);
        if (row) { jobs.push({ id: row.id, stage: "submitted", due: day, by: i, asked: 0 }); bump("jobcards.raised"); bump("jobcards.raised_by_whatsapp"); }
      }
    }
    async function whatsappOdometer(i: number) {
      const id = vehOf[i - 1], km = (await currentKm(id)) + int(20, 300);
      const reply = await chat("whatsapp.odometer_chat", waNo(i), "Submit Odometer Readings", [[/Which vehicle\?/i, () => "1"], [/Reply YES to send it/i, () => "yes"], [/reading|odometer|km/i, () => String(km)]], /recorded|received|saved|accepted|thank|flagged|noted|sent to the fleet office|has been/i);
      if (reply) { kmNow.set(id, km); bump("odometer.by_whatsapp"); }
    }
    async function whatsappTrip(i: number) {
      const reply = await chat("whatsapp.trip_chat", waNo(i), "Reserve a Trip", [
        [/What is the trip for/i, () => "Site visit"], [/Where does it start/i, () => "Lahore"], [/Where is it going/i, () => "Sheikhupura"], [/When does it leave/i, () => "tomorrow 9am"],
        [/When will the vehicle be back/i, () => "tomorrow 4pm"], [/How many passengers/i, () => "skip"], [/Do you prefer a vehicle/i, () => "skip"], [/Reply YES|\byes\b/i, () => "yes"],
      ], /Done\.|has been sent|requested/i);
      if (reply) bump("trips.reserved_by_whatsapp");
    }
    // a free-text job card: the AI reads the message and drafts it, a person confirms with YES (ADR-wa-jobcards)
    let aiDraftN = 0;
    const jobCardModel: CreateMessage = async (params) => {
      const content = params.messages[0].content as { type: string; text?: string }[];
      const meta = JSON.parse(content.find((b) => b.type === "text")!.text!) as { message: string };
      const plate = /(SIM-\d{3})/i.exec(meta.message)?.[1]?.toUpperCase() ?? null;
      aiDraftN++;
      return { content: [{ type: "text", text: JSON.stringify({ readable: !!plate, registration_no: plate, category: "corrective", reason_category: "wear_and_tear", description: meta.message.replace(/SIM-\d{3}/i, "").trim().slice(0, 200) || "Fault reported by message", priority: "normal", warnings: [] }) }], stop_reason: "end_turn", usage: { input_tokens: 120, output_tokens: 60 } } as never;
    };
    const intakeDeps: IntakeDeps = { fetchMedia: async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), mime: "image/jpeg" }), store: async () => undefined, newId: () => crypto.randomUUID(), create: jobCardModel };
    async function aiWhatsAppJobCard(i: number) {
      const from = waNo(i);
      const first = await op("ai.whatsapp_jobcard_draft", `requester ${i}`, () => processWhatsAppJobCard(d, intakeDeps, { id: `wamid.j${++wamid}`, from, contextId: null, text: `${plateOf.get(vehOf[i - 1])} ${pick(["brake noise front left", "AC not cooling", "engine light on", "tyre wearing on one side"])}`, media: [] } as InboundMessage));
      if (!first || !first.handled) return;
      const done = await op("ai.whatsapp_jobcard_confirm", `requester ${i}`, () => processWhatsAppJobCard(d, intakeDeps, { id: `wamid.j${++wamid}`, from, contextId: null, text: "Yes", media: [] } as InboundMessage));
      const no = done?.reply && /(JC-\d+)/.exec(done.reply)?.[1];
      if (no) {
        const row = await raw(async (q) => (await q.query<{ id: string }>("select id from job_cards where job_no = $1", [no])).rows[0]);
        if (row) { jobs.push({ id: row.id, stage: "submitted", due: day, by: i, asked: 0 }); bump("jobcards.raised"); bump("jobcards.raised_by_ai_message"); }
      }
    }

    async function tellWorkshops(jobId: string, winner: string, losers: string[]) {
      const a = await vf.workshopContact(d, FM, jobId, winner).catch(() => null);
      bump(`whatsapp.workshop_notice_${await notifyWorkshop("estimate_approved", a, "Simulated Logistics Co")}`);
      void losers;          // the screens tell only the workshop that was decided on; the others' estimates close by themselves, with no message
    }
    // ---- an estimate that arrives by email, is read by the AI as a draft, and is saved by a person
    const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF");
    const store: ReadableStore = { put: async () => undefined, remove: async () => undefined, signedUrl: async () => null, get: async () => PDF };
    let mailN = 0, nextDraft: { lines: Record<string, string>[]; readable: boolean } = { lines: [], readable: true };
    const estimateModel: CreateMessage = async () => {
      const lines = nextDraft.lines.map((l) => ({ description: l.description, kind: l.kind, qty: Number(l.qty), unit_cost: Number(l.unit_cost), matches_line_id: null }));
      const body = nextDraft.readable
        ? { readable: true, document_type: "estimate", document_number: `Q-${mailN}`, document_date: ymd(), currency: "PKR", stated_total: lines.reduce((a, l) => a + l.qty * l.unit_cost, 0), tax_amount: null, days_needed: 2, warranty_months: 6, valid_until: ymd(10), warnings: [], lines }
        : { readable: false, document_type: "estimate", document_number: null, document_date: null, currency: "PKR", stated_total: null, tax_amount: null, days_needed: null, warranty_months: null, valid_until: null, warnings: ["Too blurred."], lines: [] };
      return { id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: JSON.stringify(body) }], usage: { input_tokens: 500, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as never;
    };
    async function estimateByEmail(jobId: string, shopIndex: number, est: ReturnType<typeof estimate>): Promise<boolean> {
      const link = await op("email.reply_link", "fleet manager", () => vf.createWorkshopLink(d, FM, jobId, "quotation", { withReply: true }), { ref: jobId });
      if (!link || !link.replyCode) return false;
      const deps: InboundDeps = {
        fetchEmail: async (id) => ({ id, from: `Workshop <shop${shopIndex}@sim.example>`, subject: "Re: estimate", text: "Please find our estimate attached.", html: null, messageId: `<msg-${id}@sim.example>` }),
        fetchFiles: async () => [{ filename: "estimate.pdf", size: PDF.length, downloadUrl: "https://files.sim.test/a" }], download: async () => PDF, store: async () => undefined, newId: () => `f${++mailN}`,
      };
      const out = await op("email.inbound_estimate", "workshop", () => processInboundEmail(d, deps, { emailId: `em${++mailN}`, addresses: [replyAddress(link.replyCode!)] }), { ref: jobId });
      if (!out || out.status !== "filed") return false;
      bump("email.estimates_received");
      nextDraft = { lines: est.lines, readable: !chance(0.08) };
      const read = await op("ai.read_estimate", "fleet manager", () => readEmailDocument(d, store, FM, { jobId, kind: "quotation", emailId: out.emailId }, estimateModel), { ref: jobId });
      if (read && read.status === "ok") {
        const saved = await op("ai.save_estimate", "fleet manager", () => enterForWorkshop(d, FM, jobId, "quotation", { details: est.details, days_needed: est.days_needed, warranty_months: est.warranty_months, lines: est.lines }, out.emailId, read.id), { ref: jobId });
        if (saved) { bump("ai.estimates_read_and_saved"); return true; }
      } else {
        bump("ai.estimates_unreadable");
        const typed = await op("email.type_estimate_by_hand", "fleet manager", () => enterForWorkshop(d, FM, jobId, "quotation", { details: est.details, days_needed: est.days_needed, warranty_months: est.warranty_months, lines: est.lines }, out.emailId), { ref: jobId });
        if (typed) return true;
      }
      return false;
    }
    // ---- the AI compares the providers' quotes on a trip: advice only, a person still awards
    async function adviseTrip(c: Load) {
      const n = Math.min(12, (await trips.listTripQuotes(d, FM, c.tripId!)).filter((x) => x.status === "quoted").length);
      if (n < 2) return;
      const letters = Array.from({ length: n }, (_, k) => String.fromCharCode(65 + k));
      const model: CreateMessage = async () => ({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: JSON.stringify({ ranking: letters.map((l) => ({ option: l, reason: `Reason for ${l}.`, concerns: [] })), summary: `Lean towards ${letters[0]}.`, warnings: [] }) }], usage: { input_tokens: 800, output_tokens: 150, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as never);
      const r = await op("ai.trip_quote_advice", "fleet manager", () => recommendTripQuotes(d, FM, c.tripId!, model), { ref: c.id });
      if (r) bump("ai.trip_advice");
    }

    // ---- odometer: a monthly cycle with links, readings from the holders (some wrong), review, close
    async function odometerCycle() {
      const simDate = new Date(Date.now() - (DAYS - 1 - day) * 86400_000);
      const period = simDate.toISOString().slice(0, 7);
      await raw((q) => q.query("insert into settings(key, value) values ('odometer_whatsapp','1'), ('odometer_send_day','1') on conflict (key) do update set value = excluded.value"));
      const waBefore = outLines(WA_FILE).length;
      const run = await op("odometer.whatsapp_requests", "system", () => runOdometerWhatsApp(d, simDate), { ref: period });
      const mineRun = run?.find((r) => r.schema === t.schema);
      if (mineRun) { bump("odometer.whatsapp_requests_sent", mineRun.sent); if (mineRun.error) malfunctions.set(`odometer.whatsapp_requests failed: ${mineRun.error}`, { count: 1, first: period, day }); }
      bump("whatsapp.messages_written", outLines(WA_FILE).length - waBefore);
      const cycle = (await raw(async (q) => (await q.query<{ id: string }>("select id from odometer_cycles where status = 'open' order by opened_at desc limit 1")).rows[0]))?.id
        ?? (await op("odometer.open_cycle", "fleet manager", () => odo.openCycle(d, FM, period, ymd(7)), { ref: period }));
      if (!cycle) return;
      bump("odometer.cycles");
      const links = await op("odometer.create_links", "fleet manager", () => odo.createLinks(d, FM, cycle), { ref: period });
      for (const l of links ?? []) {
        const id = allVeh.find((v) => plateOf.get(v) === l.plate);
        if (!id) continue;
        const roll = rnd(); const base = await currentKm(id); let reading = base + int(800, 3500); let verdict = "normal";
        if (roll < 0.04) { reading = base - int(100, 900); verdict = "lower"; }
        else if (roll < 0.07) { reading = base + int(60000, 90000); verdict = "too_fast"; }
        else if (roll < 0.10) continue;                                                   // this holder does not answer
        const r = await op("odometer.submit_by_link", `holder of ${l.plate}`, () => submitViaLink(d, l.token, String(reading)), { ref: l.plate });
        if (r === "ok") { bump(`odometer.readings_${verdict}`); if (verdict === "normal") kmNow.set(id, reading); }
      }
      const detail = await op("odometer.read_cycle", "fleet manager", () => odo.getCycle(d, FM, cycle), { ref: period });
      const bulk = await op("odometer.approve_normal", "fleet manager", () => odo.approveNormalReadings(d, FM, cycle), { ref: period });
      if (bulk === undefined) {
        // the whole batch was refused and nothing was approved: approve the readings one by one, as a person would
        for (const sub of detail?.rows ?? []) {
          if (sub.status !== "submitted" || sub.verdict !== "normal") continue;
          const ok = await op("odometer.approve_one_by_one", "fleet manager", () => odo.reviewReading(d, FM, sub.id, "approve", "Checked, normal"), { ref: sub.id });
          if (ok) bump("odometer.approved_one_by_one");
        }
      }
      for (const sub of detail?.rows ?? []) {
        if (sub.status !== "submitted" || !sub.verdict || sub.verdict === "normal") continue;
        const ok = await op("odometer.review_flagged", "fleet manager", () => odo.reviewReading(d, FM, sub.id, chance(0.5) ? "approve" : "reject", "Checked with the holder"), { ref: sub.id });
        if (ok) bump("odometer.flagged_reviewed");
      }
      const left = await raw(async (q) => Number((await q.query<{ n: string }>("select count(*)::text n from odometer_submissions where cycle_id = $1 and status = 'submitted'", [cycle])).rows[0].n));
      if (left > 0) { const k = `a cycle was closed with ${left} reading(s) still waiting for review`; malfunctions.set(k, { count: (malfunctions.get(k)?.count ?? 0) + 1, first: period, day }); }
      await op("odometer.close_cycle", "fleet manager", () => odo.closeCycle(d, FM, cycle), { ref: period });
    }

    // ---- accidents, challans, renewals and the daily reminders
    async function complianceDay() {
      for (let k = int(0, 2); k > 0; k--) {
        const i = int(1, REQUESTERS), veh = vehOf[i - 1];
        const jobOnVeh = chance(0.4) ? jobs.find((j) => j.by === i && j.stage !== "rejected") : undefined;
        const a = await op("accident.add", "fleet manager", () => comp.addAccident(d, FM, { vehicle_id: veh, employee_id: empOf[i - 1], occurred_at: new Date(Date.now() - int(0, 3) * 86400_000 - 3600_000).toISOString(), location: pick(["Ferozepur Road", "GT Road", "Mall Road", "Motorway M2"]),
          description: pick(["Rear-ended at a signal", "Scraped a wall while reversing", "Hit by another vehicle at the junction", "Skidded in the rain"]) + ` (${++ref})`, severity: pick(["minor", "minor", "moderate", "major"]), fault: pick(["third_party", "our_driver", "shared", "unknown"]),
          insurance_claim: chance(0.5) ? "on" : "", claim_ref: "" }), { ref: String(ref) });
        if (a) { bump("accidents.added"); if (jobOnVeh) { const ok = await op("accident.link_jobcard", "fleet manager", () => comp.linkAccidentJobCard(d, FM, a, jobOnVeh.id), { ref: a, expect: /not for this vehicle|already/i }); if (ok) bump("accidents.linked_to_jobcard"); } }
      }
      for (let k = int(0, 4); k > 0; k--) {
        const i = int(1, REQUESTERS);
        const c = await op("challan.add", "fleet manager", () => comp.addChallan(d, FM, { vehicle_id: vehOf[i - 1], employee_id: empOf[i - 1], issued_on: ymd(-int(0, 3)), reference: `CH-${++ref}`, violation: pick(["Over speed", "Signal violation", "Wrong parking", "No seat belt"]), amount: String(pick([500, 1000, 2000, 5000])) }), { ref: String(ref) });
        if (c) { challans.push({ id: c, due: day + int(3, 10) }); bump("challans.added"); }
      }
      for (const c of challans) {
        if (c.done || c.due > day) continue;
        const to = chance(0.75) ? "paid" : "disputed";
        const ok = await op("challan.set_status", "fleet manager", () => comp.setChallanStatus(d, FM, c.id, to), { ref: c.id });
        if (ok) { c.done = true; bump(`challans.${to}`); }
      }
      // renewals: papers that expire within a week (or already have) are renewed most of the time
      const docs = await op("paper.list", "fleet manager", () => comp.listDocuments(d, FM, {}));
      for (const x of docs ?? []) {
        if (x.days_left > 7 || !chance(0.6)) continue;
        const ok = await op("paper.renew", "fleet manager", () => comp.addDocument(d, FM, { vehicle_id: x.vehicle_id, doc_type: x.doc_type, reference: `${x.reference ?? "REN"}-R`, issued_by: x.issued_by ?? "Renewal", valid_from: ymd(), expires_on: ymd(365), amount: "9000" }), { ref: x.entity_id });
        if (ok) bump("papers.renewed");
      }
      // the daily job that makes the reminders (also the maintenance reminders), then what it mailed
      const before = outLines(EMAIL_FILE).length;
      const runs = await op("reminders.run", "system", () => runDocumentReminders(d), { ref: `day ${day + 1}` });
      const mine = runs?.find((r) => r.schema === t.schema);
      if (mine) { bump("reminders.notices", mine.sent); bump("reminders.emails", mine.emailed ?? 0); if (mine.error) malfunctions.set(`reminders.run failed: ${mine.error}`, { count: 1, first: "", day }); }
      const sentToday = outLines(EMAIL_FILE).slice(before).map((l) => (JSON.parse(l) as { to: string }).to);
      const dup = sentToday.filter((x, k) => sentToday.indexOf(x) !== k);
      if (dup.length) malfunctions.set(`reminder email sent twice to the same person on one day: ${dup[0]}`, { count: dup.length, first: "", day });
    }

    // ------------------------------------------------ moving the calendar
    const shiftOneDay = () => {
      const sql = `
        set session_replication_role = replica;
        do $f$ declare r record; sets text; begin
          for r in select c.table_name from information_schema.tables c where c.table_schema = '${t.schema}' and c.table_type = 'BASE TABLE' loop
            select string_agg(format('%I = %I - interval ''1 day''', column_name, column_name), ', ') into sets
              from information_schema.columns where table_schema = '${t.schema}' and table_name = r.table_name and data_type in ('timestamp with time zone', 'date') and is_generated = 'NEVER' and not (table_name = 'odometer_cycles' and column_name = 'period');   -- a month label: a check says it is the first of a month
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
      if (day === 30 || day === DAYS - 1) await odometerCycle();     // a month apart: a cycle on day 0 would see readings taken minutes after the vehicles were made
      await raiseJobs(); await raiseCargo(); await hrDay();
      const people = shuffle(Array.from({ length: REQUESTERS }, (_, k) => k + 1));      // different people for each kind of message today: a person who sends too many is told to wait
      for (const i of people.slice(0, 4)) await whatsappJobCard(i);
      for (const i of people.slice(4, 7)) await aiWhatsAppJobCard(i);
      for (const i of people.slice(7, 15)) await whatsappCargo(i);
      for (const i of people.slice(15, 23)) await whatsappOdometer(i);
      for (const i of people.slice(23, 26)) await whatsappTrip(i);
      await complianceDay();
      await progressJobs(); await progressCargo();
      await auditorDay();
      const row: Record<string, number> = { day: day + 1, seconds: Math.round((Date.now() - d0) / 1000) };
      for (const k of Object.keys(counts)) row[k] = (counts[k] ?? 0) - (before[k] ?? 0);
      byDay.push(row);
      if (day % 5 === 4 || day === DAYS - 1) console.log(`day ${day + 1}/${DAYS}: ${JSON.stringify(row)}  [${Math.round((Date.now() - t0) / 60000)} min, ${malfunctions.size} kinds of malfunction so far]`);
    }
    // let everything in flight finish: a few more days with no new work
    for (let extra = 0; extra < 14; extra++) { day = DAYS + extra; shiftOneDay(); await progressJobs(); await progressCargo(); await complianceDay(); }

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
    await check("no reminder was sent before its time (days before expiry)", `select r.entity_id, r.days_before from document_reminders r join (select id, expires_on from compliance_docs union all select id, valid_to from insurance_policies) d on d.id = r.entity_id where d.expires_on - r.sent_at::date > r.days_before`);
    await check("a paper that has expired (and not been renewed) was reminded about on its day", `select v.entity_id, v.doc_type, v.expires_on from v_documents_expiring v where v.expires_on < current_date - 1 and not exists (select 1 from document_reminders r where r.entity_id = v.entity_id and r.days_before = 0)`);
    await check("every vehicle that was serviced has a service reminder claim or none was due", `select 1 where false`);
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
    const emailLines = outLines(EMAIL_FILE).map((l) => JSON.parse(l) as { to: string; subject: string });
    const waLines = outLines(WA_FILE).map((l) => JSON.parse(l) as Record<string, unknown>);
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
      "## Mail and WhatsApp written to files (nothing was sent)", "", `Emails: ${emailLines.length} (${[...new Set(emailLines.map((e) => e.subject.replace(/[0-9]+/g, "n").slice(0, 50)))].slice(0, 8).join("; ")}). To ${new Set(emailLines.map((e) => e.to)).size} different addresses.`,
      `WhatsApp template messages: ${waLines.length}${waLines.length ? ` (${[...new Set(waLines.map((w) => String(w.template ?? w.name ?? "?")))].join(", ")})` : ""}.`, "",
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
