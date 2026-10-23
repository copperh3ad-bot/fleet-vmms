import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import type { BlobStore } from "@/lib/jobcards/attachments";
import { addPolicy, listPolicies, parsePolicy, removePolicy } from "@/lib/master/policy";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let a: { tenantId: string; schema: string }, b: { tenantId: string; schema: string };
const mem = (t: { tenantId: string; schema: string }, role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });

function fakeStore() {
  const files = new Map<string, Uint8Array>();
  const store: BlobStore = {
    async put(path, bytes) { files.set(path, bytes); },
    async remove(path) { files.delete(path); },
    async signedUrl(path) { return files.has(path) ? `https://signed.example/${path}` : null; },
  };
  return { store, files };
}
const pdf = (n = 100) => Uint8Array.from([0x25, 0x50, 0x44, 0x46, ...new Array(n).fill(1)]);

beforeAll(async () => {
  d = await testDriver();
  a = await provisionTenant(d, { name: "Alpha Haulage", slug: "alpha", ownerUserId: U(1), ownerName: "Owner A" }, tenantMigrations(), { transform: stripExt });
  b = await provisionTenant(d, { name: "Bravo Transport", slug: "bravo", ownerUserId: U(2), ownerName: "Owner B" }, tenantMigrations(), { transform: stripExt });
});

describe("the form", () => {
  it("needs a name, accepts an optional date and note, and says which field is wrong", () => {
    expect(parsePolicy({ title: "  Fleet policy 2026 ", effective_from: "2026-01-31", notes: " v2 " })).toEqual({ title: "Fleet policy 2026", effective_from: "2026-01-31", notes: "v2" });
    expect(parsePolicy({ title: "Fleet policy" })).toEqual({ title: "Fleet policy", effective_from: null, notes: null });
    const e = (() => { try { parsePolicy({ title: "x", effective_from: "31/01/2026", notes: "n".repeat(1001) }); } catch (x) { return x as UserError; } })()!;
    expect(Object.keys(e.fields ?? {}).sort()).toEqual(["effective_from", "notes", "title"]);
    expect(() => parsePolicy({ title: "Fleet policy", effective_from: "2026-02-31x" })).toThrow(UserError);
  });
});

describe("uploading and reading", () => {
  it("keeps versions, the newest is current, and the file sits in the company's own folder", async () => {
    const { store, files } = fakeStore();
    await addPolicy(d, store, mem(a, "tenant_admin", 1), { title: "Policy 2025" }, { name: "policy-2025.pdf", bytes: pdf() });
    await new Promise((r) => setTimeout(r, 5));
    await addPolicy(d, store, mem(a, "fleet_manager", 3), { title: "Policy 2026", effective_from: "2026-01-01", notes: "Service every 5,000 km" }, { name: "policy 2026.pdf", bytes: pdf() });
    expect([...files.keys()].every((p) => p.startsWith(`${a.schema}/maintenance_policy/`))).toBe(true);
    const list = await listPolicies(d, store, mem(a, "requester", 4));
    expect(list.map((p) => [p.title, p.current])).toEqual([["Policy 2026", true], ["Policy 2025", false]]);
    expect(list[0]).toMatchObject({ effective_from: "2026-01-01", notes: "Service every 5,000 km" });
    expect(list.every((p) => p.file?.url?.startsWith("https://signed.example/"))).toBe(true);
  });

  it("only managers upload or remove; workshops cannot even read; finance, auditor and requester read", async () => {
    const { store } = fakeStore();
    await expect(addPolicy(d, store, mem(a, "requester", 4), { title: "Mine" }, { name: "x.pdf", bytes: pdf() })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addPolicy(d, store, mem(a, "finance", 5), { title: "Mine" }, { name: "x.pdf", bytes: pdf() })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listPolicies(d, store, mem(a, "vendor", 6))).rejects.toBeInstanceOf(ForbiddenError);
    for (const role of ["finance", "auditor", "requester", "fleet_manager", "tenant_admin"]) await listPolicies(d, store, mem(a, role, 7));
    const first = (await listPolicies(d, store, mem(a, "tenant_admin", 1)))[0];
    await expect(removePolicy(d, store, mem(a, "requester", 4), first.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("refuses a wrong file type, an empty file or a missing name, and leaves no half-saved policy", async () => {
    const { store, files } = fakeStore();
    const before = (await listPolicies(d, store, mem(a, "tenant_admin", 1))).length;
    await expect(addPolicy(d, store, mem(a, "tenant_admin", 1), { title: "Word file" }, { name: "policy.docx", bytes: pdf() })).rejects.toBeInstanceOf(UserError);
    await expect(addPolicy(d, store, mem(a, "tenant_admin", 1), { title: "Empty" }, { name: "policy.pdf", bytes: new Uint8Array() })).rejects.toBeInstanceOf(UserError);
    await expect(addPolicy(d, store, mem(a, "tenant_admin", 1), { title: "" }, { name: "policy.pdf", bytes: pdf() })).rejects.toBeInstanceOf(UserError);
    expect(files.size).toBe(0);
    expect((await listPolicies(d, store, mem(a, "tenant_admin", 1))).length).toBe(before);
  });

  it("remove deletes the record and the file; a policy that does not exist is a plain message", async () => {
    const { store, files } = fakeStore();
    const id = await addPolicy(d, store, mem(a, "tenant_admin", 1), { title: "Temporary" }, { name: "t.pdf", bytes: pdf() });
    expect(files.size).toBe(1);
    await removePolicy(d, store, mem(a, "tenant_admin", 1), id);
    expect(files.size).toBe(0);
    expect((await listPolicies(d, store, mem(a, "tenant_admin", 1))).some((p) => p.id === id)).toBe(false);
    await expect(removePolicy(d, store, mem(a, "tenant_admin", 1), id)).rejects.toBeInstanceOf(UserError);
  });
});

describe("one company never sees another's policy", () => {
  it("lists, files and removal stay inside the company", async () => {
    const { store, files } = fakeStore();
    const secret = await addPolicy(d, store, mem(b, "tenant_admin", 2), { title: "Bravo secret policy", notes: "bravo-only-marker" }, { name: "bravo.pdf", bytes: pdf() });
    const seenByA = JSON.stringify(await listPolicies(d, store, mem(a, "tenant_admin", 1)));
    expect(seenByA).not.toContain("Bravo secret policy");
    expect(seenByA).not.toContain("bravo-only-marker");
    expect(seenByA).not.toContain(b.schema);
    await expect(removePolicy(d, store, mem(a, "tenant_admin", 1), secret)).rejects.toBeInstanceOf(UserError);
    expect([...files.keys()].every((p) => p.startsWith(`${b.schema}/`))).toBe(true);
    expect((await listPolicies(d, store, mem(b, "tenant_admin", 2))).map((p) => p.title)).toEqual(["Bravo secret policy"]);
  });

  it("the database refuses a policy file whose path points at another company's folder", async () => {
    const id = await addPolicy(d, fakeStore().store, mem(a, "tenant_admin", 1), { title: "Guard check" }, { name: "g.pdf", bytes: pdf() });
    const insert = (path: string) => withTenant(d, mem(a, "tenant_admin", 1), (q) =>
      q.query("insert into attachments(entity_type, entity_id, storage_path, file_name) values ('maintenance_policy', $1, $2, 'a.pdf')", [id, path]));
    await expect(insert(`${b.schema}/maintenance_policy/x/a.pdf`)).rejects.toThrow(/tenant folder/);
  });
});
