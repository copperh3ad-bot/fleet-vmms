import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { secretBox } from "@/lib/crypto/secretbox";
import { routingDriver, type RoutingDriver } from "@/lib/db/router";
import { withTenant } from "@/lib/db/tenant";
import { listNotifications } from "@/lib/jobcards/service";
import { reminderFor, runBillingReminders } from "@/lib/billing/reminders";
import type { BillingRow } from "@/lib/billing/state";
import { advanceProvisioning, type ProvisionDeps } from "@/lib/orgs/provision";
import { claimSignup, parseSignup, recordSignup } from "@/lib/orgs/signup";
import { farm, newControl, platformMigrations, stripExt, tenantMigrations } from "./helpers";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const NOW = new Date("2026-10-23T12:00:00Z");
const plus = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();
const row = (over: Partial<BillingRow> = {}): BillingRow => ({ status: "trialing", trial_ends_at: plus(72), current_period_end: null, grace_days: 5, comped: false, suspended: false, price_cents: 14900, currency: "USD", ...over });
const paid = (endH: number): BillingRow => row({ status: "active", trial_ends_at: null, current_period_end: plus(endH) });

describe("what to say and when", () => {
  it("nothing early in a trial, a warning on the last day, a notice when it is over", () => {
    expect(reminderFor(row(), NOW)).toBeNull();
    expect(reminderFor(row({ trial_ends_at: plus(30) }), NOW)).toBeNull();                          // two days left
    expect(reminderFor(row({ trial_ends_at: plus(20) }), NOW)).toMatchObject({ key: "trial_ending", text: expect.stringMatching(/1 day left/) });
    expect(reminderFor(row({ trial_ends_at: plus(-2) }), NOW)).toMatchObject({ key: "trial_ended" });
  });

  it("a renewal reminder in the last three days, then late, then locked; each once per period", () => {
    expect(reminderFor(paid(24 * 10), NOW)).toBeNull();
    const r = reminderFor(paid(24 * 2), NOW)!;
    expect(r.key).toBe(`renewal:${plus(48).slice(0, 10)}`);
    expect(r.text).toMatch(/renews in 2 days/);
    expect(reminderFor(paid(-12), NOW)).toMatchObject({ key: expect.stringMatching(/^late:/) });
    expect(reminderFor(paid(-24 * 6), NOW)).toMatchObject({ key: expect.stringMatching(/^locked:/) });
    expect(reminderFor(row({ comped: true }), NOW)).toBeNull();
    expect(reminderFor(row({ suspended: true }), NOW)).toBeNull();                                  // the operator's own decision needs no notice
  });
});

describe("sending them", () => {
  let control: Awaited<ReturnType<typeof newControl>>;
  let router: RoutingDriver;
  let org: { tenantId: string; schema: string };
  let admin: { tenantId: string; schema: string; userId: string; role: string; vehicleScope: "all" };

  beforeAll(async () => {
    control = await newControl();
    const f = farm();
    const box = secretBox(randomBytes(32));
    const deps: ProvisionDeps = { control, provider: f.provider(), openDb: f.open, box, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(), transform: stripExt, connectRetries: { tries: 1, delayMs: 1 } };
    router = routingDriver({ control, makeDriver: f.open, decrypt: box.decrypt });
    await recordSignup(control, parseSignup({ org_name: "Remind Fleet", contact_name: "Rana", email: "rana@example.com", terms: "on" }));
    org = (await claimSignup(control, { id: U(1), email: "rana@example.com", emailConfirmed: true }))!;
    await advanceProvisioning(deps, org.tenantId);
    admin = { ...org, userId: U(1), role: "tenant_admin", vehicleScope: "all" };
  });

  const setTrial = (hours: number) => control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("update public.org_billing set trial_ends_at = now() + ($2 || ' hours')::interval where tenant_id = $1", [org.tenantId, String(hours)]); });

  it("tells the administrator once, in the app, and not again if the job runs twice", async () => {
    expect(await runBillingReminders(router)).toEqual([]);                                          // a fresh trial: nothing to say yet
    await setTrial(10);
    const first = await runBillingReminders(router);
    expect(first).toEqual([{ schema: org.schema, sent: "trial_ending" }]);
    expect(await runBillingReminders(router)).toEqual([]);                                          // already told
    const notes = await listNotifications(router, admin);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ kind: "billing.reminder", payload: { key: "trial_ending", text: expect.stringMatching(/Free trial: 1 day left/) } });
  });

  it("the next stage is a new notice, and a locked organization is still told, once", async () => {
    await setTrial(-5);
    expect((await runBillingReminders(router)).map((r) => r.sent)).toEqual(["trial_ended"]);
    expect(await runBillingReminders(router)).toEqual([]);
    expect((await listNotifications(router, admin)).map((n) => n.payload.key).sort()).toEqual(["trial_ended", "trial_ending"]);
  });

  it("only people who run billing are told, and the operator's lock and the waiver silence it", async () => {
    await withTenant(router, admin, (q) => q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'requester')", [U(2), org.tenantId]));
    await setTrial(8);
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("delete from public.billing_reminders where tenant_id = $1", [org.tenantId]); });
    await runBillingReminders(router);
    expect(await listNotifications(router, { ...admin, userId: U(2), role: "requester" }).catch(() => [])).toEqual([]);   // a requester sees nothing about billing
    await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("delete from public.billing_reminders where tenant_id = $1", [org.tenantId]); await q.query("update public.org_billing set comped = true where tenant_id = $1", [org.tenantId]); });
    expect(await runBillingReminders(router)).toEqual([]);
  });
});
