import { afterEach, describe, expect, it } from "vitest";
import { WhatsAppNotConfigured, failedStatuses, sendWhatsAppInvite, whatsappInviteConfigured } from "@/lib/whatsapp";

// ADR-049: the app sends the invitation itself, from its own WhatsApp number, with an approved template whose button is the only place the token goes.
const KEYS = ["WHATSAPP_FILE", "ALLOW_FILE_MAILER", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_TEMPLATE_LANG", "WHATSAPP_INVITE_TEMPLATE"];
const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
const fake = (status = 200) => { const calls: { url: string; init: RequestInit }[] = []; const f = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response("{}", { status }); }) as unknown as typeof fetch; return { calls, f }; };
const setEnv = (env: Record<string, string>) => { for (const k of KEYS) delete process.env[k]; Object.assign(process.env, env); };
afterEach(() => { for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } });
const cfg = { WHATSAPP_PHONE_NUMBER_ID: "109876543210", WHATSAPP_ACCESS_TOKEN: "stand-in-value", WHATSAPP_INVITE_TEMPLATE: "fleetotg_invite" };
const LINK_ID = "a1b2".repeat(10) + "c3d";            // 43 characters, the shape of a real one

describe("sending an invitation from the app's number", () => {
  it("is on only when the number, the token and the invitation template are all set", () => {
    setEnv({ WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "t" });
    expect(whatsappInviteConfigured()).toBe(false);          // no template: the old buttons stay
    setEnv({ WHATSAPP_INVITE_TEMPLATE: "fleetotg_invite" });
    expect(whatsappInviteConfigured()).toBe(false);          // no number or token
    setEnv(cfg);
    expect(whatsappInviteConfigured()).toBe(true);
  });

  it("sends the template with the name and company in the body and only the token in the button", async () => {
    setEnv({ ...cfg, WHATSAPP_TEMPLATE_LANG: "en_US" });
    const { calls, f } = fake();
    await sendWhatsAppInvite("+923001234567", { name: "Bilal Ahmed", org: "Lahore Fleet", token: LINK_ID, siteUrl: "https://www.fleetotg.com" }, f);
    expect(calls[0].url).toBe("https://graph.facebook.com/v21.0/109876543210/messages");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer stand-in-value");
    const sent = JSON.parse(String(calls[0].init.body));
    expect(sent).toMatchObject({ messaging_product: "whatsapp", to: "923001234567", type: "template", template: { name: "fleetotg_invite", language: { code: "en_US" } } });
    expect(sent.template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "Bilal Ahmed" }, { type: "text", text: "Lahore Fleet" }] },
      { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: LINK_ID }] },
    ]);
    expect(JSON.stringify(sent.template.components[0])).not.toContain(LINK_ID);        // the link is never in the visible text
  });

  it("cleans names so line breaks cannot break the template, and never sends an empty variable", async () => {
    setEnv(cfg);
    const { calls, f } = fake();
    await sendWhatsAppInvite("+923001234567", { name: "  Bilal\nAhmed\t  ", org: "", token: LINK_ID, siteUrl: "x" }, f);
    const body = JSON.parse(String(calls[0].init.body)).template.components[0].parameters.map((p: { text: string }) => p.text);
    expect(body).toEqual(["Bilal Ahmed", "your company"]);
  });

  it("fails plainly when Meta refuses or nothing is set up", async () => {
    setEnv(cfg);
    await expect(sendWhatsAppInvite("+923001234567", { name: "A", org: "B", token: LINK_ID, siteUrl: "x" }, fake(400).f)).rejects.toThrow("whatsapp invite failed: 400");
    setEnv({});
    await expect(sendWhatsAppInvite("+923001234567", { name: "A", org: "B", token: LINK_ID, siteUrl: "x" })).rejects.toBeInstanceOf(WhatsAppNotConfigured);
  });

  it("puts Meta's reason in the error, without phone numbers or token-shaped strings", async () => {
    setEnv(cfg);
    const body = { error: { code: 131042, error_subcode: 2494, message: "Business eligibility payment issue for 923001234567 " + "x".repeat(40) } };
    const f = (async () => new Response(JSON.stringify(body), { status: 400 })) as unknown as typeof fetch;
    const err = await sendWhatsAppInvite("+923001234567", { name: "A", org: "B", token: LINK_ID, siteUrl: "x" }, f).catch((e: Error) => e);
    expect((err as Error).message).toContain("whatsapp invite failed: 400 (code 131042/2494: Business eligibility payment issue");
    expect((err as Error).message).not.toContain("923001234567");
    expect((err as Error).message).not.toContain("x".repeat(40));
  });

  it("reads why an accepted message did not arrive from the status call, for our number only, with no numbers in it", () => {
    const hook = (id: string, statuses: unknown[]) => ({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: id }, statuses } }] }] });
    const failed = { status: "failed", recipient_id: "923001234567", id: "wamid.XYZ", errors: [{ code: 131042, title: "Business eligibility payment issue", message: "x 923001234567" }] };
    expect(failedStatuses(hook("111", [failed, { status: "delivered" }, { status: "read" }]), "111")).toEqual([{ code: 131042, title: "Business eligibility payment issue" }]);
    expect(failedStatuses(hook("222", [failed]), "111")).toEqual([]);          // another number
    expect(failedStatuses({ entry: "nonsense" }, "111")).toEqual([]);
    expect(failedStatuses(null, "111")).toEqual([]);
    expect(JSON.stringify(failedStatuses(hook("111", [{ status: "failed", errors: [{ code: 1, message: "to 923001234567 failed" }] }]), "111"))).not.toContain("923001234567");
  });

  it("writes to the test file instead of sending, only when file mode is allowed", async () => {
    setEnv({ WHATSAPP_FILE: "/dev/null", ALLOW_FILE_MAILER: "1" });
    await expect(sendWhatsAppInvite("+923001234567", { name: "A", org: "B", token: LINK_ID, siteUrl: "https://s.test" }, fake(500).f)).resolves.toBeUndefined();
    setEnv({ WHATSAPP_FILE: "/dev/null" });
    await expect(sendWhatsAppInvite("+923001234567", { name: "A", org: "B", token: LINK_ID, siteUrl: "x" })).rejects.toBeInstanceOf(WhatsAppNotConfigured);
  });
});
