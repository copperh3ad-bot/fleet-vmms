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
async function hook(from: string, text: string, opts: { sign?: boolean; phoneId?: string } = {}) {
  const { POST } = await import("@/app/api/inbound/whatsapp/route");
  const body = JSON.stringify({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: opts.phoneId ?? "PNID" }, messages: [{ id: `wamid.${++seq}`, from: from.replace(/\D/g, ""), type: "text", text: { body: text } }] } }] }] });
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
  await withPlatform(d, async (q) => {
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
    expect(sent().at(-1)?.body).toMatch(/Hello Hook, this is Fleet OTG for Hook Fleet[\s\S]*3\. Reserve a Trip/);
    expect(await hook("+923007001111", "3")).toBe(200);
    expect(sent().at(-1)?.body).toMatch(/What is the trip for/);
  });
  it("a stranger saying Hi is not answered by the menu, and a call for another number is ignored", async () => {
    expect(await hook("+923009990000", "Hi")).toBe(200);
    expect(sent().some((m) => /Fleet OTG for/.test(m.body))).toBe(false);                    // the older flows answer a stranger as before
    rmSync(OUT, { force: true });
    expect(await hook("+923007001111", "Hi", { phoneId: "OTHER" })).toBe(200);
    expect(sent()).toEqual([]);
  });
});
