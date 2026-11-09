import { afterAll, describe, expect, it } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listPayload, parseWebhook, sendReplyList } from "@/lib/whatsapp";

// ADR-079: the menu is a tappable WhatsApp list. What goes out, what comes back, and the limits WhatsApp sets.
const hook = (message: Record<string, unknown>) => ({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PNID" }, messages: [{ id: "wamid.1", from: "923001112222", ...message }] } }] }] });

describe("a row tapped in a list we sent", () => {
  it("arrives as the id of the row, handled exactly like the same words typed", () => {
    expect(parseWebhook(hook({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "3", title: "Reserve a Trip" } } }), "PNID")).toEqual([
      { id: "wamid.1", from: "+923001112222", contextId: null, text: "3", media: [] },
    ]);
    expect(parseWebhook(hook({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "skip", title: "Skip" } } }), "PNID")[0].text).toBe("skip");
  });
  it("is ignored when the id is not one we could have made", () => {
    expect(parseWebhook(hook({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "<script>" } } }), "PNID")).toEqual([]);
    expect(parseWebhook(hook({ type: "interactive", interactive: { type: "list_reply", list_reply: { id: "x".repeat(60) } } }), "PNID")).toEqual([]);
    expect(parseWebhook(hook({ type: "interactive", interactive: {} }), "PNID")).toEqual([]);
  });
});

describe("the list message we send", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), title: `A very long row title number ${i + 1}`, description: "d".repeat(100) }));
  it("keeps to WhatsApp's limits: 10 rows, 24-character titles, 72-character descriptions, a 20-character button, a 1024-character body", () => {
    const p = listPayload("+923001112222", "b".repeat(2000), "Choose something now please", rows);
    expect(p).toMatchObject({ messaging_product: "whatsapp", to: "923001112222", type: "interactive" });
    const i = p.interactive;
    expect(i.type).toBe("list");
    expect(i.body.text).toHaveLength(1024);
    expect(i.action.button.length).toBeLessThanOrEqual(20);
    const r = i.action.sections[0].rows;
    expect(r).toHaveLength(10);
    expect(r.every((x) => x.title.length <= 24 && (x.description?.length ?? 0) <= 72)).toBe(true);
  });
  it("is written to a file instead of sent in the test set-up, with the rows", async () => {
    const out = path.join(tmpdir(), `wa-list-${process.pid}.jsonl`);
    const env0 = { ...process.env };
    process.env.ALLOW_FILE_MAILER = "1"; process.env.WHATSAPP_FILE = out;
    try {
      await sendReplyList("+923001112222", "What would you like to do?", "Choose", [{ id: "1", title: "Submit a Job Card" }]);
      expect(JSON.parse(readFileSync(out, "utf8").trim())).toEqual({ to: "+923001112222", body: "What would you like to do?", list: [{ id: "1", title: "Submit a Job Card" }] });
    } finally { process.env = { ...env0 }; rmSync(out, { force: true }); }
  });
  afterAll(() => { for (const f of [path.join(tmpdir(), `wa-list-${process.pid}.jsonl`)]) if (existsSync(f)) rmSync(f); });
});
