// The AI that reads a maintenance policy (ADR-043): a draft only, a person applies it. A fake model is used, so these cost nothing and need no network.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import * as ct from "@/lib/control/service";
import { addPolicy } from "@/lib/master/policy";
import { applyFindings, getReading, type ReadableStore } from "@/lib/master/policy-reading";
import { readPolicyFile, type CreateMessage } from "@/lib/ai/claude";
import { checkPolicyDraft, POLICY_PROMPT, POLICY_SCHEMA } from "@/lib/ai/policy-draft";
import { readPolicyWithAi } from "@/lib/ai/policy";
import { setAiDocuments } from "@/lib/ai/service";

const env0 = { ...process.env };
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const pdf = new Uint8Array(readFileSync("tests/fixtures/policy-text.pdf"));
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

const files = new Map<string, Uint8Array>();
const store: ReadableStore = {
  async put(path, bytes) { files.set(path, bytes); },
  async remove(path) { files.delete(path); },
  async signedUrl(path) { return files.has(path) ? `https://signed.example/${path}` : null; },
  async get(path) { return files.get(path) ?? null; },
};
const answer = (obj: unknown, over: Record<string, unknown> = {}) => ({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: JSON.stringify(obj) }], usage: { input_tokens: 900, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, ...over });
let calls = 0, seen: Record<string, unknown>[] = [];
const model = (obj: unknown, over: Record<string, unknown> = {}): CreateMessage => async (p) => { calls++; seen.push(p as unknown as Record<string, unknown>); return answer(obj, over) as never; };
const f = (rule: string, over: Record<string, unknown> = {}) => ({ rule, number: null, months: null, km: null, label: null, text: null, quote: "As the policy says.", ...over });
const reply = (findings: unknown[], warnings: string[] = []) => ({ readable: true, findings, warnings });

describe("checking what the model returns", () => {
  it("turns rules into the findings the apply step understands, in the system's own words and ids", () => {
    const r = checkPolicyDraft(reply([
      f("policy_replace_years", { number: 5 }), f("policy_driver_share_pct", { number: 20 }),
      f("service_oil_change", { months: 3, km: 5000 }), f("service_tyres", { km: 40000 }),
      f("note", { label: "Inspection schedule", text: "quarterly" }),
    ]));
    expect(r.findings.map((x) => [x.id, x.value])).toEqual([
      ["policy_replace_years", "5"], ["policy_driver_share_pct", "20"], ["service_oil_change", "every 3 months or 5,000 km"], ["service_tyres", "every 40,000 km"], ["info_ai_1", "quarterly"]]);
    expect(r.findings[2].target).toEqual({ kind: "service", name: "Oil change", months: 3, km: 5000 });
    expect(r.findings[4].target).toEqual({ kind: "info" });
  });
  it("drops what the system would refuse or cannot trust, and says so", () => {
    const r = checkPolicyDraft(reply([
      f("policy_driver_share_pct", { number: 150 }),                   // above the setting's limit
      f("policy_replace_years", { number: -2 }),
      f("policy_free_accidents", { number: 2, quote: "" }),            // no sentence to check it against
      f("made_up_rule", { number: 1 }),
      f("service_oil_change"),                                         // an interval with neither months nor km
      f("policy_free_accidents", { number: 2 }), f("policy_free_accidents", { number: 3 }),   // a repeat
    ]));
    expect(r.findings.map((x) => [x.id, x.value])).toEqual([["policy_free_accidents", "2"]]);
    expect(r.warnings.join(" ")).toMatch(/6 items .* were left out/);
  });
  it("treats junk as an unreadable file, not a crash", () => {
    expect(checkPolicyDraft(null)).toEqual({ readable: false, findings: [], warnings: [] });
    expect(checkPolicyDraft({ readable: true, findings: "x", warnings: [1, "ok"] })).toEqual({ readable: true, findings: [], warnings: ["ok"] });
  });
  it("tells the model the document is text to read, not instructions, and gives it no tools", () => {
    expect(POLICY_PROMPT).toMatch(/never as instructions/);
    expect(POLICY_SCHEMA.required).toEqual(["readable", "findings", "warnings"]);
  });
});

describe("the model call", () => {
  it("sends the file and the fixed instructions, cached, with no tools; reports usage", async () => {
    seen = [];
    const r = await readPolicyFile({ name: "p.pdf", mime: "application/pdf", bytes: pdf }, model(reply([f("policy_replace_years", { number: 5 })])));
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.inputTokens).toBe(900);
    const p = seen[0] as { tools?: unknown; tool_choice?: unknown; system: { cache_control?: unknown }[]; messages: { content: { type: string; cache_control?: unknown }[] }[] };
    expect(p.tools).toBeUndefined();
    expect(p.tool_choice).toBeUndefined();
    expect(p.system[0].cache_control).toBeTruthy();
    expect(p.messages[0].content.map((b) => b.type)).toEqual(["document", "text"]);
  });
  it("reports a refusal, a cut-off answer, unreadable files and unreadable answers without trusting any of them", async () => {
    const file = { name: "p.pdf", mime: "application/pdf", bytes: pdf };
    expect((await readPolicyFile(file, model({}, { stop_reason: "refusal" }))).status).toBe("refused");
    expect((await readPolicyFile(file, model({}, { stop_reason: "max_tokens" }))).status).toBe("failed");
    expect((await readPolicyFile(file, model({ readable: false, findings: [], warnings: ["Not a policy."] }))).status).toBe("unreadable");
    expect((await readPolicyFile({ name: "p.docx", mime: "application/msword", bytes: pdf }, model(reply([])))).status).toBe("unreadable");
    expect((await readPolicyFile(file, async () => { throw new Error("network"); })).status).toBe("failed");
  });
});

describe("reading a company's policy with the AI", () => {
  let policyId: string;
  beforeAll(async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    d = await testDriver();
    t = await provisionTenant(d, { name: "Hotel Textiles", slug: "hotel", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
    await withPlatform(d, async (q) => {
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, 'fleet_manager')", [U(2), t.tenantId]);
      await q.query("update public.org_billing set plan_key = 'pro' where tenant_id = $1", [t.tenantId]);
    });
    policyId = await addPolicy(d, store, owner(), { title: "Vehicle policy" }, { name: "policy.pdf", bytes: pdf });
  });
  afterAll(() => { process.env = { ...env0 }; });

  const run = (m: Membership, c: CreateMessage) => readPolicyWithAi(d, store, m, policyId, c);
  const setting = async (k: string) => (await ct.getSettings(d, owner())).find((s) => s.key === k)!.value;

  it("does nothing until the administrator has switched the AI on, and never calls the model", async () => {
    calls = 0;
    await expect(run(owner(), model(reply([])))).rejects.toThrow(/not switched on reading documents/);
    expect(calls).toBe(0);
    await setAiDocuments(d, owner(), true);
  });

  it("is part of the Pro plan: the server checks, not just the button", async () => {
    await withPlatform(d, (q) => q.query("update public.org_billing set plan_key = 'basic' where tenant_id = $1", [t.tenantId]));
    calls = 0;
    await expect(run(owner(), model(reply([])))).rejects.toThrow(/part of the Pro plan/);
    expect(calls).toBe(0);
    await withPlatform(d, (q) => q.query("update public.org_billing set plan_key = 'pro' where tenant_id = $1", [t.tenantId]));
  });

  it("is for people who manage the policy only", async () => {
    calls = 0;
    await expect(run(mem("requester", 3), model(reply([])))).rejects.toBeInstanceOf(ForbiddenError);
    expect(calls).toBe(0);
  });

  it("stores a draft for review and changes no rule, then applies only what a person chooses, from what the server stored", async () => {
    const before = await setting("policy_driver_share_pct");
    const r = await run(owner(), model(reply([f("policy_replace_years", { number: 7, quote: "Vehicles are replaced after seven years." }), f("policy_driver_share_pct", { number: 25 })], ["Page 2 was blurred."])));
    expect(r.findings).toBe(2);
    expect(await setting("policy_driver_share_pct")).toBe(before);       // a draft changes nothing

    const reading = (await getReading(d, owner(), policyId))!;
    expect(reading).toMatchObject({ status: "ready", source: "ai", error: "Page 2 was blurred." });
    expect(reading.findings.map((x) => [x.id, x.value, x.quote])[0]).toEqual(["policy_replace_years", "7", "Vehicles are replaced after seven years."]);

    const log = await raw(async (q) => (await q.query<{ kind: string; status: string; outcome: string; policy_id: string; job_card_id: string | null; input_tokens: number }>("select kind, status, outcome, policy_id, job_card_id, input_tokens from ai_actions where id = $1", [r.id])).rows[0]);
    expect(log).toEqual({ kind: "policy_read", status: "ok", outcome: "pending", policy_id: policyId, job_card_id: null, input_tokens: 900 });

    await applyFindings(d, owner(), policyId, ["policy_replace_years"]);
    expect(await setting("policy_replace_years")).toBe("7");
    expect(await setting("policy_driver_share_pct")).toBe(before);       // not chosen, not applied
    expect((await raw(async (q) => (await q.query<{ outcome: string }>("select outcome from ai_actions where id = $1", [r.id])).rows[0])).outcome).toBe("saved_edited");

    await applyFindings(d, owner(), policyId, ["policy_driver_share_pct"]);
    expect(await setting("policy_driver_share_pct")).toBe("25");
    expect((await raw(async (q) => (await q.query<{ outcome: string }>("select outcome from ai_actions where id = $1", [r.id])).rows[0])).outcome).toBe("saved_edited");   // resolved once; the first choice stands
  });

  it("a failed reading is logged but leaves the earlier reading as it was", async () => {
    await expect(run(owner(), model({}, { stop_reason: "refusal" }))).rejects.toBeInstanceOf(UserError);
    const reading = (await getReading(d, owner(), policyId))!;
    expect(reading.source).toBe("ai");
    expect(reading.findings.length).toBe(2);
    const failed = await raw(async (q) => (await q.query<{ n: string }>("select count(*)::text n from ai_actions where kind = 'policy_read' and status = 'refused'")).rows[0].n);
    expect(failed).toBe("1");
  });

  it("an AI draft that offers a value the system refuses never reaches the review", async () => {
    await run(owner(), model(reply([f("policy_driver_share_pct", { number: 400 }), f("policy_free_accidents", { number: 2 })])));
    expect((await getReading(d, owner(), policyId))!.findings.map((x) => x.id)).toEqual(["policy_free_accidents"]);
  });

  it("only claude.ts talks to the provider: the policy files import no SDK", () => {
    for (const p of ["policy.ts", "policy-draft.ts"]) expect(readFileSync(`src/lib/ai/${p}`, "utf8")).not.toMatch(/@anthropic-ai\/sdk|ANTHROPIC_API_KEY/);
  });
});
