import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import * as master from "@/lib/master/service";

// ADR-079: the signed WhatsApp webhook hands a known employee's "Hi" to the menu, and the reply goes out. The route is called as Meta would call it.
const holder = vi.hoisted(() => ({ driver: null as unknown }));
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), getDriver: () => holder.driver }));
vi.mock("@/lib/client-ip", () => ({ clientIp: async () => "203.0.113.9" }));

const OUT = path.join(tmpdir(), `wa-menu-webhook-${process.pid}.jsonl`);
const env0 = { ...process.env };
const SECRET = "test-app-secret";
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const admin = () => ({ ...t, userId: U(1), role: "tenant_admin", vehicleScope: "all" as const });
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, admin(), fn);

let seq = 0;
async function hook(from: string, text: string, opts: { sign?: boolean; phoneId?: string; tapped?: string } = {}) {
  const { POST } = await import("@/app/api/inbound/whatsapp/route");
  const message = opts.tapped ? { type: "interactive", interactive: { type: "list_reply", list_reply: { id: opts.tapped, title: "x" } } } : { type: "text", text: { body: text } };
  const body = JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: opts.phoneId ?? "PNID" }, messages: [{ id: `wamid.${++seq}`, from: from.replace(/\D/g, ""), ...message }] } }] }] });
  const sig = opts.sign === false ? "sha256=00" : `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
  const res = await POST(new Request("https://example.test/api/inbound/whatsapp", { method: "POST", headers: { "x-hub-signature-256": sig, "content-length": String(body.length) }, body }) as never);
  return res.status;
}
const sent = () => (existsSync(OUT) ? readFileSync(OUT, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { to: string; body: string }) : []);

beforeAll(async () => {
  Object.assign(process.env, { WHATSAPP_APP_SECRET: SECRET, WHATSAPP_VERIFY_TOKEN: "v", WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "PNID", ALLOW_FILE_MAILER: "1", WHATSAPP_FILE: OUT });
  d = await testDriver();
  holder.driver = d;
  t = await provisionTenant(d, { name: "Hook Fleet", slug: "hookfleet", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  const e = (await master.saveEmployee(d, admin(), { full_name: "Hook Driver", employee_no: "H-1" })).id;
  await raw((q) => q.query("update employees set phone = '0300 7001111', user_id = $2 where id = $1", [e, U(71)]));
  const lg = (await master.saveEmployee(d, admin(), { full_name: "Hook Logistics", employee_no: "H-2" })).id;
  await raw((q) => q.query("update employees set phone = '0300 7002222', user_id = $2 where id = $1", [lg, U(72)]));
  await withPlatform(d, async (q) => {
    await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'logistics')", [U(72), t.tenantId]);
    await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'requester')", [U(71), t.tenantId]);
    await q.query("update public.org_billing set plan_key = 'pro' where tenant_id = $1", [t.tenantId]);
    await q.query("update public.tenants set wa_menu_enabled = true where id = $1", [t.tenantId]);
  });
  await raw((q) => q.query("insert into settings(key, value) values ('module_trips','1') on conflict (key) do update set value = '1'"));
});
beforeEach(async () => { rmSync(OUT, { force: true }); await withPlatform(d, (q) => q.query("delete from public.rate_limits")); });
afterAll(() => { rmSync(OUT, { force: true }); process.env = { ...env0 }; });

describe("the signed webhook and the menu", () => {
  it("refuses a call that is not signed by Meta, and sends nothing", async () => {
    expect(await hook("+923007001111", "Hi", { sign: false })).toBe(401);
    expect(sent()).toEqual([]);
  });
  it("a known employee saying Hi gets the menu back on WhatsApp, and answering a number gets the first question", async () => {
    expect(await hook("+923007001111", "Hi")).toBe(200);
    expect(sent().at(-1)).toMatchObject({ to: "+923007001111" });
    expect(sent().at(-1)?.body).toMatch(/Hello Hook, this is Fleet OTG for Hook Fleet/);
    expect((sent().at(-1) as unknown as { list: { title: string }[] }).list.map((r) => r.title)).toContain("Reserve a Trip");
    expect(await hook("+923007001111", "3")).toBe(200);
    expect(sent().at(-1)?.body).toMatch(/What is the trip for/);
  });
  it("the menu goes out as a tappable list, and tapping a row is the same as typing its number", async () => {
    await hook("+923007001111", "cancel");                                            // the test before left a question open
    rmSync(OUT, { force: true });
    expect(await hook("+923007001111", "Hi")).toBe(200);
    const list = sent().at(-1) as unknown as { to: string; body: string; list: { id: string; title: string }[] };
    expect(list.list.map((r) => r.id)).toEqual(["1", "2", "3", "4"]);
    expect(list.body).toMatch(/Tap the button to choose/);
    expect(await hook("+923007001111", "", { tapped: "3" })).toBe(200);
    expect(sent().at(-1)?.body).toMatch(/What is the trip for/);
  });
  const setCaps = (logistics: string | null, other: string | null) => withPlatform(d, async (q) => {
    for (const [k, v] of [["wa_daily_messages", logistics], ["wa_daily_messages_other", other]] as const)
      if (v === null) await q.query("delete from public.platform_settings where key = $1", [k]);
      else await q.query("insert into public.platform_settings(key, value) values ($1, $2) on conflict (key) do update set value = excluded.value", [k, v]);
    await q.query("delete from public.rate_limits");
  });
  it("everyone but the Logistics department is held to the lower daily cap: told once, then ignored; a stranger the same (ADR-081)", async () => {
    await hook("+923007001111", "cancel");
    await setCaps("5", "3");
    try {
      rmSync(OUT, { force: true });
      for (let i = 0; i < 3; i++) expect(await hook("+923007001111", "Hi")).toBe(200);
      const before = sent().length;
      expect(before).toBeGreaterThanOrEqual(3);
      expect(await hook("+923007001111", "Hi")).toBe(200);                                  // the 4th: refused, told once
      expect(sent().length).toBe(before + 1);
      expect(sent().at(-1)?.body).toMatch(/limit of 3 messages/);
      expect(await hook("+923007001111", "Hi")).toBe(200);                                  // the 5th: ignored in silence
      expect(sent().length).toBe(before + 1);
      rmSync(OUT, { force: true });
      for (let i = 0; i < 4; i++) await hook("+923009990000", "Hi");                          // a number nobody registered is held to the same lower cap
      expect(sent().filter((m) => /limit of 3 messages/.test(m.body))).toHaveLength(1);
    } finally { await setCaps(null, null); await hook("+923007001111", "cancel"); }
  });
  it("a person in the Logistics department gets the higher cap, and the owner's two settings are separate", async () => {
    await setCaps("5", "3");
    try {
      rmSync(OUT, { force: true });
      for (let i = 0; i < 5; i++) await hook("+923007002222", "Hi");                          // five: past the lower cap of 3, inside the higher of 5
      expect(sent().some((m) => /limit of/.test(m.body))).toBe(false);
      await hook("+923007002222", "Hi");                                                      // the 6th
      expect(sent().at(-1)?.body).toMatch(/limit of 5 messages/);
    } finally { await setCaps(null, null); await hook("+923007002222", "cancel"); }
  });
  it("a logistics person whose login is disabled, or an employee without the department role, is not given the higher cap", async () => {
    const { isLogisticsSender } = await import("@/lib/wa-limit");
    expect(await isLogisticsSender(d, "+923007002222")).toBe(true);
    expect(await isLogisticsSender(d, "+923007001111")).toBe(false);
    expect(await isLogisticsSender(d, "+923009990000")).toBe(false);
    await withPlatform(d, (q) => q.query("update public.tenant_memberships set status = 'disabled' where user_id = $1", [U(72)]));
    try { expect(await isLogisticsSender(d, "+923007002222")).toBe(false); }
    finally { await withPlatform(d, (q) => q.query("update public.tenant_memberships set status = 'active' where user_id = $1", [U(72)])); }
  });
  it("without the settings the caps are 100 for the Logistics department and 10 for everyone else", async () => {
    const { waDailyLimit, waDailyOtherLimit, WA_DAILY_DEFAULT, WA_DAILY_OTHER_DEFAULT } = await import("@/lib/wa-limit");
    expect([WA_DAILY_DEFAULT, WA_DAILY_OTHER_DEFAULT]).toEqual([100, 10]);
    expect([await waDailyLimit(d), await waDailyOtherLimit(d)]).toEqual([100, 10]);
  });
  it("a stranger saying Hi is not answered by the menu, and a call for another number is ignored", async () => {
    expect(await hook("+923009990000", "Hi")).toBe(200);
    expect(sent().some((m) => /Fleet OTG for/.test(m.body))).toBe(false);                    // the older flows answer a stranger as before
    rmSync(OUT, { force: true });
    expect(await hook("+923007001111", "Hi", { phoneId: "OTHER" })).toBe(200);
    expect(sent()).toEqual([]);
  });
});
