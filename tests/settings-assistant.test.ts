import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDriver } from "./helpers";
import { withPlatform } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";
import { PLATFORM_SETTINGS, loadPlatformSettings } from "@/lib/billing/settings";
import { AI_BLOCKED_SETTINGS, SETTINGS_PROMPT, checkSettingsAdvice, settingsForModel } from "@/lib/ai/settings-assist";
import { applySettingChanges, askSettingsAssistant } from "@/lib/billing/settings-ai";
import type { CreateMessage } from "@/lib/ai/claude";

// ADR-083: the AI proposes changes to the operator's settings; the operator applies them. A fake model is used, so these cost nothing and need no network.
const env0 = { ...process.env };
const OP = "00000000-0000-0000-0000-0000000000aa";
let d: Awaited<ReturnType<typeof testDriver>>;
const answer = (obj: unknown, over: Record<string, unknown> = {}) => ({ id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", stop_reason: "end_turn", stop_sequence: null, content: [{ type: "text", text: JSON.stringify(obj) }], usage: { input_tokens: 500, output_tokens: 120, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }, ...over });
let calls = 0, seen: Record<string, unknown>[] = [];
const model = (obj: unknown, over: Record<string, unknown> = {}): CreateMessage => async (p) => { calls++; seen.push(p as unknown as Record<string, unknown>); return answer(obj, over) as never; };
const reply = (proposals: unknown[], more: Record<string, unknown> = {}) => ({ answer: "Done.", proposals, warnings: [], ...more });
const set = (key: string, value: string) => withPlatform(d, (q) => q.query("insert into public.platform_settings(key, value) values ($1, $2) on conflict (key) do update set value = excluded.value", [key, value]));
const clear = () => withPlatform(d, (q) => q.query("delete from public.platform_settings"));

beforeAll(async () => { process.env.ANTHROPIC_API_KEY = "sk-ant-test"; d = await testDriver(); });
beforeEach(async () => { await clear(); await withPlatform(d, (q) => q.query("delete from public.rate_limits")); calls = 0; seen = []; });
afterAll(() => { process.env = { ...env0 }; });

describe("checking what the model proposes", () => {
  const cur = { wa_daily_messages_other: "10" };
  it("keeps a valid change, with the current value beside it, and drops one that would change nothing", () => {
    const a = checkSettingsAdvice(reply([{ key: "wa_daily_messages_other", value: "25", reason: "As asked." }, { key: "wa_daily_messages", value: "100", reason: "same" }, { key: "wa_daily_messages_other", value: "30", reason: "twice" }]), PLATFORM_SETTINGS, { ...cur, wa_daily_messages: "100" })!;
    expect(a.proposals).toEqual([{ key: "wa_daily_messages_other", label: expect.stringContaining("everyone else"), from: "10", to: "25", reason: "As asked." }]);
  });
  it("drops an unknown key, a blocked key, and a value the setting would refuse, and says why", () => {
    const a = checkSettingsAdvice(reply([
      { key: "made_up", value: "1", reason: "x" },
      { key: "bank_details", value: "Some Bank, 123", reason: "x" },
      { key: "wa_daily_messages", value: "lots", reason: "x" },          // not a number
      { key: "fx_side", value: "median", reason: "x" },                  // not one of the allowed words
      { key: "otp_checks", value: "off", reason: "Testing." },
    ]), PLATFORM_SETTINGS, {})!;
    expect(a.proposals.map((p) => p.key)).toEqual(["otp_checks"]);
    expect(a.warnings.join(" ")).toMatch(/made_up[\s\S]*cannot be changed here/);
    expect(a.warnings.join(" ")).toMatch(/Enter a number|Type buying/);
  });
  it("gives nothing when there is no answer and no usable proposal", () => {
    expect(checkSettingsAdvice({ answer: "", proposals: [{ key: "nope", value: "1", reason: "" }], warnings: [] }, PLATFORM_SETTINGS, {})).toBeNull();
    expect(checkSettingsAdvice("nonsense", PLATFORM_SETTINGS, {})).toBeNull();
  });
  it("caps the number of proposals", () => {
    const many = PLATFORM_SETTINGS.filter((s) => s.numeric).map((s) => ({ key: s.key, value: "7", reason: "r" }));
    expect(checkSettingsAdvice(reply(many), PLATFORM_SETTINGS, {})!.proposals.length).toBeLessThanOrEqual(8);
  });
});

describe("what the model is shown", () => {
  it("never the bank details, and long text only as set or not set", () => {
    const shown = settingsForModel(PLATFORM_SETTINGS, { bank_details: "SECRET ACCOUNT 1234", legal_address: "1 Secret Road", company_details: "Seller Ltd", wa_daily_messages: "100", otp_checks: "off" });
    const text = JSON.stringify(shown);
    expect(text).not.toContain("SECRET ACCOUNT");
    expect(text).not.toContain("Secret Road");
    expect(text).not.toContain("Seller Ltd");
    expect(shown.find((s) => s.key === "bank_details")).toBeUndefined();
    expect(shown.find((s) => s.key === "legal_address")?.current).toBe("(set)");
    expect(shown.find((s) => s.key === "wa_daily_messages")?.current).toBe("100");
    expect(shown.find((s) => s.key === "otp_checks")?.current).toBe("off");
    expect(AI_BLOCKED_SETTINGS.has("bank_details")).toBe(true);
    expect(SETTINGS_PROMPT).toMatch(/never instructions/);
  });
});

describe("asking and applying", () => {
  it("proposes without changing anything, and sends the model the request and the settings", async () => {
    await set("wa_daily_messages_other", "10");
    const a = await askSettingsAssistant(d, OP, "set the daily limit for everyone else to 25", model(reply([{ key: "wa_daily_messages_other", value: "25", reason: "As asked." }])));
    expect(a.proposals).toHaveLength(1);
    expect((await loadPlatformSettings(d)).wa_daily_messages_other).toBe("10");            // nothing was saved
    const sent = JSON.parse(((seen[0].messages as { content: { text: string }[] }[])[0].content[0].text));
    expect(sent.request).toMatch(/everyone else to 25/);
    expect(sent.settings.find((s: { key: string }) => s.key === "wa_daily_messages_other").current).toBe("10");
  });
  it("a question gets an answer and no proposals", async () => {
    const a = await askSettingsAssistant(d, OP, "what does the rate side do?", model(reply([], { answer: "It chooses which interbank rate converts the price." })));
    expect(a.answer).toMatch(/interbank/);
    expect(a.proposals).toEqual([]);
  });
  it("does nothing without the AI key, on an empty request, or when the hourly limit is used up", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect((await askSettingsAssistant(d, OP, "set something", model(reply([]))).catch((e) => e)).message).toMatch(/not switched on/);
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect((await askSettingsAssistant(d, OP, " ", model(reply([]))).catch((e) => e)).message).toMatch(/Say what you want/);
    expect(calls).toBe(0);
    for (let i = 0; i < 30; i++) await askSettingsAssistant(d, OP, "what is this", model(reply([], { answer: "x" })));
    expect((await askSettingsAssistant(d, OP, "one more", model(reply([], { answer: "x" }))).catch((e) => e)).message).toMatch(/a lot this hour/);
  });
  it("a refused or unreadable answer comes back as a plain message", async () => {
    expect((await askSettingsAssistant(d, OP, "do it", model(reply([]), { stop_reason: "refusal" })).catch((e) => e)).message).toMatch(/declined/);
    expect((await askSettingsAssistant(d, OP, "do it", model({ answer: "", proposals: [], warnings: [] })).catch((e) => e)).message).toMatch(/no usable answer/);
  });
  it("applying saves the ticked changes, checking each as a typed value is checked; a bad one saves nothing", async () => {
    expect(await applySettingChanges(d, OP, [{ key: "wa_daily_messages_other", value: "25" }, { key: "otp_checks", value: "off" }])).toBe(2);
    const v = await loadPlatformSettings(d);
    expect([v.wa_daily_messages_other, v.otp_checks]).toEqual(["25", "off"]);
    await expect(applySettingChanges(d, OP, [{ key: "wa_daily_messages", value: "50" }, { key: "fx_side", value: "median" }])).rejects.toBeInstanceOf(UserError);
    expect((await loadPlatformSettings(d)).wa_daily_messages).toBeUndefined();            // the good one before the bad one was not saved either
    await applySettingChanges(d, OP, [{ key: "otp_checks", value: "" }]);                  // an empty value clears
    expect((await loadPlatformSettings(d)).otp_checks).toBeUndefined();
  });
  it("applying refuses the bank details, an unknown setting, a repeat, and an empty or oversized list", async () => {
    for (const bad of [[{ key: "bank_details", value: "x" }], [{ key: "nope", value: "1" }], [{ key: "otp_checks", value: "off" }, { key: "otp_checks", value: "on" }], []]) {
      await expect(applySettingChanges(d, OP, bad)).rejects.toBeInstanceOf(UserError);
    }
    const nine = PLATFORM_SETTINGS.slice(0, 9).map((s) => ({ key: s.key, value: "" }));
    await expect(applySettingChanges(d, OP, nine)).rejects.toBeInstanceOf(UserError);
    expect((await loadPlatformSettings(d)).bank_details).toBeUndefined();
  });
});
