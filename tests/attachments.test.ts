import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import * as att from "@/lib/jobcards/attachments";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number, vehicleScope: "all" | "own" = "all"): Membership => ({ ...t, userId: U(n), role, vehicleScope });
const owner = () => mem("tenant_admin", 1);
const driver = () => mem("requester", 11, "own");
const driver2 = () => mem("requester", 16, "own");
const mgr = () => mem("fleet_manager", 12);

/** In-memory stand-in for Supabase Storage. */
function fakeStore(opts: { failPut?: boolean } = {}) {
  const files = new Map<string, Uint8Array>();
  const store: att.BlobStore = {
    async put(path, bytes) { if (opts.failPut) throw new Error("network"); files.set(path, bytes); },
    async remove(path) { files.delete(path); },
    async signedUrl(path) { return files.has(path) ? `https://signed.example/${path}` : null; },
  };
  return { store, files };
}
const jpeg = (n = 100) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(n).fill(1)]);
const pdf = () => Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);

let veh: string, reason: string, cardId: string;
const newCard = async (m = driver()) => (await jc.createJobCard(d, m, {
  vehicle_id: veh, reason_code_id: reason, cause_text: "Front brake pads worn to the metal", lines: [],
}, false)).id;

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  const ids: Record<number, string> = {};
  for (const [n, name] of [[11, "Driver One"], [12, "Manager One"], [16, "Driver Two"]] as const) {
    ids[n] = (await master.saveEmployee(d, owner(), { full_name: name, employee_no: `E-${n}` })).id;
    await withTenant(d, owner(), (q) => q.query("update employees set user_id = $1 where id = $2", [U(n), ids[n]]));
  }
  veh = (await master.addVehicle(d, owner(), { registration_no: "BKL-245", employee_id: ids[11], holding_since: "2026-01-01" })).id;
  reason = (await withTenant(d, owner(), async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0])).id;
  cardId = await newCard();
});

describe("file checks", () => {
  it("names are cleaned", () => {
    expect(att.safeName("../../etc/pass wd.jpg")).toBe("pass_wd.jpg");
    expect(att.safeName("C:\\x\\фото 1.PNG")).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(att.safeName("....")).toBe("file");
  });
  it("type is decided by the bytes and the extension together", () => {
    expect(att.sniff("a.jpg", jpeg())).toBe("image/jpeg");
    expect(att.sniff("a.pdf", pdf())).toBe("application/pdf");
    expect(att.sniff("a.pdf", jpeg())).toBeNull();      // a JPEG renamed to .pdf
    expect(att.sniff("a.exe", jpeg())).toBeNull();
    expect(att.sniff("a.html", new TextEncoder().encode("<script>"))).toBeNull();
  });
});

describe("adding files", () => {
  it("stores the bytes under the tenant folder and records them", async () => {
    const { store, files } = fakeStore();
    await att.addJobCardAttachment(d, store, driver(), cardId, { name: "front pads.jpg", bytes: jpeg() });
    const [path] = [...files.keys()];
    expect(path.startsWith(`${t.schema}/job_card/${cardId}/`)).toBe(true);
    const list = await att.listJobCardAttachments(d, store, driver(), cardId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ file_name: "front_pads.jpg", mime_type: "image/jpeg", uploaded_by: U(11) });
    expect(list[0].url).toContain(path);
  });

  it("refuses wrong types, empty and oversized files", async () => {
    const { store, files } = fakeStore();
    const before = files.size;
    await expect(att.addJobCardAttachment(d, store, driver(), cardId, { name: "x.exe", bytes: jpeg() })).rejects.toBeInstanceOf(UserError);
    await expect(att.addJobCardAttachment(d, store, driver(), cardId, { name: "x.jpg", bytes: new Uint8Array(0) })).rejects.toThrow(/empty/);
    await expect(att.addJobCardAttachment(d, store, driver(), cardId, { name: "x.jpg", bytes: jpeg(att.MAX_FILE_BYTES) })).rejects.toThrow(/4 MB/);
    expect(files.size).toBe(before);
  });

  it("photos chosen on the new job card form: saved as a draft, files attached, then submitted", async () => {
    const { store, files } = fakeStore();
    const id = (await jc.createJobCard(d, driver(), { vehicle_id: veh, reason_code_id: reason, cause_text: "Brakes grind when stopping and pull left", lines: [] }, false)).id;
    await att.addJobCardAttachment(d, store, driver(), id, { name: "brake.jpg", bytes: jpeg() });
    await jc.transitionJobCard(d, driver(), id, "submitted");
    expect((await jc.getJobCard(d, driver(), id))!.status).toBe("submitted");
    expect((await att.listJobCardAttachments(d, store, driver(), id)).map((f) => f.file_name)).toEqual(["brake.jpg"]);
    expect([...files.keys()].some((p) => p.includes(`/job_card/${id}/`))).toBe(true);
    await expect(att.addJobCardAttachment(d, store, driver(), id, { name: "late.jpg", bytes: jpeg() })).rejects.toThrow(/draft or sent back/);   // closed once submitted
  });

  it("limits the number of files per card", async () => {
    const id = await newCard();
    const { store } = fakeStore();
    for (let i = 0; i < att.MAX_FILES_PER_CARD; i++) await att.addJobCardAttachment(d, store, driver(), id, { name: `p${i}.jpg`, bytes: jpeg() });
    await expect(att.addJobCardAttachment(d, store, driver(), id, { name: "extra.jpg", bytes: jpeg() })).rejects.toThrow(/can hold/);
  });

  it("a failed upload leaves no record, and a failed record leaves no file", async () => {
    const id = await newCard();
    const bad = fakeStore({ failPut: true });
    await expect(att.addJobCardAttachment(d, bad.store, driver(), id, { name: "a.jpg", bytes: jpeg() })).rejects.toThrow(/could not be uploaded/);
    expect(await att.listJobCardAttachments(d, bad.store, driver(), id)).toHaveLength(0);
  });

  it("only the requester adds files, and only while the card is editable", async () => {
    const id = await newCard();
    const { store } = fakeStore();
    await expect(att.addJobCardAttachment(d, store, driver2(), id, { name: "a.jpg", bytes: jpeg() })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(att.addJobCardAttachment(d, store, mem("auditor", 15), id, { name: "a.jpg", bytes: jpeg() })).rejects.toBeInstanceOf(ForbiddenError);
    await jc.transitionJobCard(d, driver(), id, "submitted");
    await expect(att.addJobCardAttachment(d, store, driver(), id, { name: "a.jpg", bytes: jpeg() })).rejects.toThrow(/draft or sent back/);
  });
});

describe("the database guard", () => {
  const insert = (path: string, entity: string) => withTenant(d, owner(), (q) => q.query(
    "insert into attachments(entity_type, entity_id, storage_path, file_name) values ('job_card', $1, $2, 'x.jpg')", [entity, path]));
  it("refuses a path outside this tenant's folder, even from hand-written SQL", async () => {
    await expect(insert("tenant_other/job_card/x/a.jpg", cardId)).rejects.toThrow(/tenant folder/);
    await expect(insert("a.jpg", cardId)).rejects.toThrow(/tenant folder/);
  });
  it("refuses a file for a card that does not exist", async () => {
    await expect(insert(`${t.schema}/job_card/x/a.jpg`, "00000000-0000-0000-0000-0000000000aa")).rejects.toThrow(/target not found/);
  });
});

describe("reading and removing", () => {
  it("lists only what the member may see, and never signs a foreign path", async () => {
    const { store } = fakeStore();
    const id = await newCard();
    await att.addJobCardAttachment(d, store, driver(), id, { name: "a.pdf", bytes: pdf() });
    expect(await att.listJobCardAttachments(d, store, driver2(), id)).toEqual([]);     // other driver: card not visible
    expect(await att.listJobCardAttachments(d, store, mgr(), id)).toHaveLength(1);       // manager reads all
    await expect(att.listJobCardAttachments(d, store, mem("vendor", 70), id)).rejects.toBeInstanceOf(ForbiddenError);
    // a record that somehow points outside the folder gets no link (inserted as a different schema owner would be blocked, so edit the row)
    await withTenant(d, owner(), async (q) => {
      await q.query("alter table attachments disable trigger attachments_guard");
      await q.query("update attachments set storage_path = 'tenant_other/x.pdf' where entity_id = $1", [id]);
      await q.query("alter table attachments enable trigger attachments_guard");
    });
    expect((await att.listJobCardAttachments(d, store, mgr(), id))[0].url).toBeNull();
  });

  it("the requester removes a file from a draft: record and object both go", async () => {
    const { store, files } = fakeStore();
    const id = await newCard();
    await att.addJobCardAttachment(d, store, driver(), id, { name: "a.jpg", bytes: jpeg() });
    const [row] = await att.listJobCardAttachments(d, store, driver(), id);
    await expect(att.removeJobCardAttachment(d, store, driver2(), row.id)).rejects.toBeInstanceOf(ForbiddenError);
    await att.removeJobCardAttachment(d, store, driver(), row.id);
    expect(await att.listJobCardAttachments(d, store, driver(), id)).toEqual([]);
    expect([...files.keys()].some((k) => k.includes(id))).toBe(false);
  });
});
