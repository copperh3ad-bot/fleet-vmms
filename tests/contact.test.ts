// The public Contact us form (ADR-021): the fields are checked, one row is stored, and only the operator can read or close messages.
import { beforeAll, describe, expect, it } from "vitest";
import { UserError } from "@/lib/master/service";
import { countNewContactMessages, listContactMessages, markContactHandled, parseContact, recordContact } from "@/lib/contact";
import { newControl } from "./helpers";

const OP = "00000000-0000-0000-0000-0000000000a1";
const STRANGER = "00000000-0000-0000-0000-0000000000b2";
const form = (over: Record<string, unknown> = {}) => ({ name: "Sara Khan", email: "Sara@Acme.example", company: "", topic: "sales", message: "Do you support fleets of fifty vehicles?", ...over });

let control: Awaited<ReturnType<typeof newControl>>;

beforeAll(async () => {
  control = await newControl();
  await control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query("insert into public.platform_admins(user_id) values ($1)", [OP]); });
});

describe("the form", () => {
  it("lowercases the email, drops an empty company and checks every field", () => {
    expect(parseContact(form())).toEqual({ name: "Sara Khan", email: "sara@acme.example", topic: "sales", message: "Do you support fleets of fifty vehicles?" });
    expect(parseContact(form({ company: " Acme " })).company).toBe("Acme");
    const e = (() => { try { parseContact(form({ name: "S", email: "nope", topic: "spam", message: "short" })); } catch (x) { return x as UserError; } })()!;
    expect(Object.keys(e.fields ?? {}).sort()).toEqual(["email", "message", "name", "topic"]);
    expect(() => parseContact(form({ message: "x".repeat(2001) }))).toThrow(UserError);
    expect(() => parseContact(form({ company: "x".repeat(121) }))).toThrow(UserError);
  });
});

describe("storing and reading", () => {
  it("stores one row per message, newest waiting ones first", async () => {
    await recordContact(control, parseContact(form()));
    await recordContact(control, parseContact(form({ name: "Omar Ali", topic: "billing", company: "Ali Logistics", message: "Where do I find my payment reference?" })));
    const rows = await listContactMessages(control, OP);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "new")).toBe(true);
    expect(rows.map((r) => r.name).sort()).toEqual(["Omar Ali", "Sara Khan"]);
    expect(await countNewContactMessages(control, OP)).toBe(2);
  });

  it("only an operator can read, count or close messages", async () => {
    await expect(listContactMessages(control, STRANGER)).rejects.toBeInstanceOf(UserError);
    await expect(countNewContactMessages(control, STRANGER)).rejects.toBeInstanceOf(UserError);
    const [first] = await listContactMessages(control, OP);
    await expect(markContactHandled(control, STRANGER, first.id)).rejects.toBeInstanceOf(UserError);
    expect((await listContactMessages(control, OP)).find((r) => r.id === first.id)!.status).toBe("new");
  });

  it("marking handled moves a message down the list and out of the count", async () => {
    const [first] = await listContactMessages(control, OP);
    await markContactHandled(control, OP, first.id);
    const after = await listContactMessages(control, OP);
    expect(after.find((r) => r.id === first.id)!.status).toBe("handled");
    expect(after[after.length - 1].id).toBe(first.id);
    expect(await countNewContactMessages(control, OP)).toBe(1);
    await markContactHandled(control, OP, first.id);   // doing it twice changes nothing
    expect(await countNewContactMessages(control, OP)).toBe(1);
  });

  it("the database refuses what the form would have refused", async () => {
    const bad = (sql: string, p: unknown[]) => control.transaction(async (q) => { await q.query("set local search_path = public"); await q.query(sql, p); });
    const ins = "insert into public.contact_messages(name, email, topic, message) values ($1, $2, $3, $4)";
    await expect(bad(ins, ["Sara", "sara@acme.example", "spam", "a perfectly long message"])).rejects.toThrow();
    await expect(bad(ins, ["Sara", "sara@acme.example", "sales", "short"])).rejects.toThrow();
    await expect(bad(ins, ["Sara", "sara@acme.example", "sales", "x".repeat(2001)])).rejects.toThrow();
  });
});
