import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cargoFormJson, formDate, formDateTime, jobCardFormJson, tripFormJson, TIMES, UNITS, VEHICLE_TYPES, WORK_KINDS, URGENCIES } from "@/lib/wa-menu/forms";
import { flowPayload, parseWebhook } from "@/lib/whatsapp";

// ADR-084: the WhatsApp forms (Flows). The JSON is what Meta checks when it is uploaded; these tests hold it to Meta's published limits and to our own wiring.
type Node = { type?: string; name?: string; label?: string; "helper-text"?: string; "data-source"?: { id: string; title: string }[]; children?: Node[]; "on-click-action"?: { name: string; payload?: Record<string, string>; next?: { name: string } } };
type Screen = { id: string; title: string; terminal?: boolean; data?: Record<string, unknown>; layout: { children: Node[] } };
const forms: [string, { version: string; screens: Screen[] }][] = [["cargo", cargoFormJson()], ["trip", tripFormJson()], ["jobcard", jobCardFormJson()]];
const fieldsOf = (s: Screen) => (s.layout.children[0].children ?? []).filter((n) => n.type !== "Footer");
const footerOf = (s: Screen) => (s.layout.children[0].children ?? []).find((n) => n.type === "Footer")!;

describe.each(forms)("the %s form's JSON", (_name, json) => {
  it("keeps to Meta's limits: titles, labels, helper text, option titles", () => {
    for (const s of json.screens) {
      expect(s.title.length).toBeLessThanOrEqual(30);
      for (const f of fieldsOf(s)) {
        expect(String(f.label).length).toBeLessThanOrEqual(20);
        if (f["helper-text"]) expect(f["helper-text"].length).toBeLessThanOrEqual(80);
        for (const o of f["data-source"] ?? []) { expect(o.title.length).toBeLessThanOrEqual(30); expect(o.id).not.toBe(""); }
        expect(new Set((f["data-source"] ?? []).map((o) => o.id)).size).toBe((f["data-source"] ?? []).length);
      }
      expect(footerOf(s).label!.length).toBeLessThanOrEqual(35);
    }
  });
  it("names every field once, passes every answer on, and ends in one terminal screen that sends them all", () => {
    const all: string[] = [];
    json.screens.forEach((s, i) => {
      const own = fieldsOf(s).map((f) => String(f.name));
      expect(new Set([...all, ...own]).size).toBe(all.length + own.length);                    // no name twice across screens
      const action = footerOf(s)["on-click-action"]!;
      const last = i === json.screens.length - 1;
      expect(action.name).toBe(last ? "complete" : "navigate");
      expect(Object.keys(action.payload!).sort()).toEqual([...all, ...own].sort());             // everything so far is carried on
      for (const n of own) expect(action.payload![n]).toBe(`\${form.${n}}`);
      for (const n of all) expect(action.payload![n]).toBe(`\${data.${n}}`);
      if (!last) { expect(action.next!.name).toBe(json.screens[i + 1].id); expect(s.terminal).toBeUndefined(); }
      else expect(s.terminal).toBe(true);
      if (i > 0) expect(Object.keys(s.data ?? {}).sort()).toEqual([...all].sort());            // a later screen declares what it receives
      all.push(...own);
    });
  });
});

describe("the option lists", () => {
  it("are non-empty, distinct, and match the chat's own lists", () => {
    for (const list of [VEHICLE_TYPES, UNITS, WORK_KINDS, URGENCIES, TIMES]) expect(new Set(list.map((o) => o.id)).size).toBe(list.length);
    expect(WORK_KINDS.map((o) => o.id)).toEqual(["periodic", "brakes", "suspension", "battery", "body", "lights", "tyres", "alignment", "ac", "others"]);
    expect(URGENCIES.map((o) => o.id)).toEqual(["low", "normal", "high", "urgent"]);
    expect(TIMES[0].id).toBe("05:00");
    expect(TIMES.at(-1)!.id).toBe("22:30");
  });
});

describe("the committed form files (docs/whatsapp-flows) are what the code builds", () => {
  it("match, so the file the owner uploads is the file the app reads", () => {
    for (const [name, json] of forms) expect(readFileSync(`docs/whatsapp-flows/${name}.json`, "utf8")).toBe(`${JSON.stringify(json, null, 2)}\n`);
  });
});

describe("reading a form's date and time", () => {
  const now = new Date("2026-11-09T05:00:00Z");
  it("takes a date as YYYY-MM-DD or as milliseconds, and refuses anything else", () => {
    expect(formDate("2026-11-12")).toBe("2026-11-12");
    expect(formDate(String(Date.UTC(2026, 10, 12, 0, 0, 0)))).toBe("2026-11-12");
    expect(formDate("12/11/2026")).toBeNull();
    expect(formDate(undefined)).toBeNull();
  });
  it("joins date and time as the Pakistan time the typed answers give, and keeps the future-only rule", () => {
    expect(formDateTime("2026-11-12", "09:30", now, "the vehicle needed on")).toEqual({ ok: true, value: "2026-11-12T09:30:00+05:00" });
    expect(formDateTime("2026-11-01", "09:30", now, "the departure").ok).toBe(false);
    expect(formDateTime("2026-11-12", "soon", now, "the departure").ok).toBe(false);
    expect(formDateTime(undefined, "09:30", now, "the departure").ok).toBe(false);
  });
});

describe("a form sent and a form answered", () => {
  it("is sent with a token, the form's id and its first screen; a draft form says so", () => {
    const p = flowPayload("+923001234567", { flowId: "123456", token: "tok-1", screen: "WHEN_WHERE", body: "Please fill in the form.", cta: "Open form" });
    expect(p).toMatchObject({ to: "923001234567", type: "interactive", interactive: { type: "flow", action: { name: "flow", parameters: { flow_id: "123456", flow_token: "tok-1", flow_cta: "Open form", flow_action_payload: { screen: "WHEN_WHERE" } } } } });
    expect((p.interactive.action.parameters as Record<string, unknown>).mode).toBeUndefined();
    expect((flowPayload("+92300", { flowId: "1", token: "t", screen: "S", body: "b", cta: "c", draft: true }).interactive.action.parameters as Record<string, unknown>).mode).toBe("draft");
  });
  it("arrives as plain answers: strings and numbers, short names, nothing else", () => {
    const hook = (response_json: unknown) => ({ entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "PNID" }, messages: [{ id: "wamid.1", from: "923001234567", type: "interactive", interactive: { type: "nfm_reply", nfm_reply: { name: "flow", response_json } } }] } }] }] });
    const [m] = parseWebhook(hook(JSON.stringify({ flow_token: "tok-1", department: "Sales", quantity: 12, nested: { a: 1 }, "bad key!": "x", list: [1, 2], ok: true })), "PNID");
    expect(m.flow).toEqual({ flow_token: "tok-1", department: "Sales", quantity: "12" });
    expect(m.text).toBe("");
    expect(parseWebhook(hook("not json"), "PNID")).toEqual([]);
    expect(parseWebhook(hook(JSON.stringify([1, 2])), "PNID")).toEqual([]);
    expect(parseWebhook(hook("x".repeat(25_000)), "PNID")).toEqual([]);
  });
});
