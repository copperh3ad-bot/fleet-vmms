import { afterEach, describe, expect, it } from "vitest";
import { TEMPLATE_ENV, notifyWorkshop, workshopParams, type WorkshopContact, type WorkshopEvent } from "@/lib/vendorflow/whatsapp-notify";

// ADR-056: what a workshop is told on WhatsApp after it sends an estimate or an invoice. Best effort, and only through templates the owner has set.
const KEYS = [...Object.values(TEMPLATE_ENV), "WHATSAPP_FILE", "ALLOW_FILE_MAILER", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_ACCESS_TOKEN"];
const before = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => { for (const k of KEYS) { if (before[k] === undefined) delete process.env[k]; else process.env[k] = before[k]; } });
const configure = (events: WorkshopEvent[]) => { for (const k of KEYS) delete process.env[k]; Object.assign(process.env, { WHATSAPP_PHONE_NUMBER_ID: "1", WHATSAPP_ACCESS_TOKEN: "stand-in" }); for (const e of events) process.env[TEMPLATE_ENV[e]] = `tpl_${e}`; };
const contact: WorkshopContact = { vendor_name: "Quick Fix Motors", phone: "+923001234567", job_no: "JC-1042" };
const recorder = () => { const calls: { to: string; name: string; params: string[] }[] = []; return { calls, send: (async (to: string, t: { name: string; params: string[] }) => { calls.push({ to, name: t.name, params: t.params }); return "wamid.x"; }) as never }; };

describe("what the workshop is told", () => {
  it("fills each template's variables in the order its approved text has them", () => {
    expect(workshopParams("estimate_approved", contact, "Hotel Textiles")).toEqual(["Quick Fix Motors", "Hotel Textiles", "JC-1042"]);
    expect(workshopParams("invoice_accepted", contact, "Hotel Textiles")).toEqual(["Quick Fix Motors", "Hotel Textiles", "JC-1042"]);
    expect(workshopParams("estimate_declined", contact, "Hotel Textiles", "labour is higher\nthan agreed")).toEqual(["Quick Fix Motors", "Hotel Textiles", "JC-1042", "labour is higher than agreed"]);
    expect(workshopParams("invoice_queried", contact, "Hotel Textiles", "  total   does not match  ")).toEqual(["Quick Fix Motors", "Hotel Textiles", "JC-1042", "total does not match"]);
  });

  it("never sends an empty or multi-line variable, and keeps a long reason short", () => {
    expect(workshopParams("estimate_declined", contact, "Hotel Textiles", "   ")[3]).toBe("please see the job card on Fleet OTG");
    expect(workshopParams("invoice_queried", contact, "Hotel Textiles")[3]).toBe("please check the figures");
    expect(workshopParams("estimate_declined", contact, "", "x".repeat(500))[3]).toHaveLength(160);
    expect(workshopParams("estimate_approved", { ...contact, vendor_name: "  " }, "")[0]).toBe("there");
    expect(workshopParams("estimate_approved", contact, "")[1]).toBe("your customer");
  });

  it("sends the template that is set for the event, to the workshop's number, and no other", async () => {
    configure(["estimate_approved", "estimate_declined"]);
    const r = recorder();
    expect(await notifyWorkshop("estimate_approved", contact, "Hotel Textiles", undefined, r.send)).toBe("sent");
    expect(await notifyWorkshop("estimate_declined", contact, "Hotel Textiles", "too dear", r.send)).toBe("sent");
    expect(r.calls).toEqual([
      { to: "+923001234567", name: "tpl_estimate_approved", params: ["Quick Fix Motors", "Hotel Textiles", "JC-1042"] },
      { to: "+923001234567", name: "tpl_estimate_declined", params: ["Quick Fix Motors", "Hotel Textiles", "JC-1042", "too dear"] },
    ]);
  });

  it("sends nothing when the template for that event is not set, or WhatsApp is not set up, or the workshop has no mobile number", async () => {
    const r = recorder();
    configure(["estimate_approved"]);
    expect(await notifyWorkshop("invoice_accepted", contact, "Hotel Textiles", undefined, r.send)).toBe("not_set_up");
    expect(await notifyWorkshop("estimate_approved", null, "Hotel Textiles", undefined, r.send)).toBe("no_phone");
    expect(await notifyWorkshop("estimate_approved", { ...contact, phone: "" }, "Hotel Textiles", undefined, r.send)).toBe("no_phone");
    for (const k of KEYS) delete process.env[k];
    process.env[TEMPLATE_ENV.estimate_approved] = "tpl_estimate_approved";
    expect(await notifyWorkshop("estimate_approved", contact, "Hotel Textiles", undefined, r.send)).toBe("not_set_up");
    expect(r.calls).toHaveLength(0);
  });

  it("a failing send is reported, not thrown, and the error carries no number", async () => {
    configure(["invoice_queried"]);
    const logged: string[] = [];
    const orig = console.error; console.error = (m: string) => { logged.push(String(m)); };
    try {
      const boom = (async () => { throw new Error("whatsapp failed: 400 (code 131049: held back)"); }) as never;
      expect(await notifyWorkshop("invoice_queried", contact, "Hotel Textiles", "check", boom)).toBe("failed");
    } finally { console.error = orig; }
    expect(logged.join(" ")).toContain("131049");
    expect(logged.join(" ")).not.toContain("923001234567");
  });
});
