import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { UserError } from "@/lib/master/service";
import * as att from "@/lib/jobcards/attachments";
import { addVehicleFile, listVehicleFiles, removeVehicleFile } from "@/lib/master/files";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number, vehicleScope: "all" | "own" = "all"): Membership => ({ ...t, userId: U(n), role, vehicleScope });
const owner = () => mem("tenant_admin", 1);
const mgr = () => mem("fleet_manager", 12);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

function fakeStore() {
  const files = new Map<string, Uint8Array>();
  const store: att.BlobStore = {
    async put(path, bytes) { files.set(path, bytes); },
    async remove(path) { files.delete(path); },
    async signedUrl(path) { return files.has(path) ? `https://signed.example/${path}` : null; },
  };
  return { store, files };
}
const jpeg = (n = 100) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(n).fill(1)]);

let vehMine: string, vehOther: string;

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Delta Textiles", slug: "delta", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  const holder = (await master.saveEmployee(d, owner(), { full_name: "Driver One", employee_no: "E-11" })).id;
  await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(11), holder]));
  vehMine = (await master.addVehicle(d, owner(), { registration_no: "BKL-245", employee_id: holder, holding_since: "2026-01-01" })).id;
  vehOther = (await master.addVehicle(d, owner(), { registration_no: "BKL-300" })).id;
});

describe("vehicle photo and registration scan", () => {
  it("stores the files under the tenant folder, tells the kinds apart, and lists them", async () => {
    const { store, files } = fakeStore();
    await addVehicleFile(d, store, mgr(), vehMine, "photo", { name: "front.jpg", bytes: jpeg() });
    await addVehicleFile(d, store, mgr(), vehMine, "registration", { name: "book.jpg", bytes: jpeg() });
    expect([...files.keys()].every((p) => p.startsWith(`${t.schema}/vehicle/${vehMine}/`))).toBe(true);
    const list = await listVehicleFiles(d, store, mgr(), vehMine);
    expect(list.map((f) => f.kind).sort()).toEqual(["photo", "registration"]);
    expect(list.every((f) => f.url?.startsWith("https://signed.example/"))).toBe(true);
    expect(await listVehicleFiles(d, store, mgr(), vehOther)).toEqual([]);
  });

  it("only vehicle.write adds or removes; a person limited to their own vehicle sees only that vehicle's files", async () => {
    const { store } = fakeStore();
    await addVehicleFile(d, store, mgr(), vehOther, "photo", { name: "side.jpg", bytes: jpeg() });
    await expect(addVehicleFile(d, store, mem("requester", 11, "own"), vehMine, "photo", { name: "x.jpg", bytes: jpeg() })).rejects.toBeInstanceOf(ForbiddenError);
    const mine = mem("requester", 11, "own");
    expect(await listVehicleFiles(d, store, mine, vehOther)).toEqual([]);                      // not their vehicle
    await addVehicleFile(d, store, mgr(), vehMine, "photo", { name: "again.jpg", bytes: jpeg() });
    expect((await listVehicleFiles(d, store, mine, vehMine)).length).toBeGreaterThan(0);        // their own
    const first = (await listVehicleFiles(d, store, mgr(), vehMine))[0];
    await expect(removeVehicleFile(d, store, mine, first.id)).rejects.toBeInstanceOf(ForbiddenError);
    await removeVehicleFile(d, store, mgr(), first.id);
    expect((await listVehicleFiles(d, store, mgr(), vehMine)).some((f) => f.id === first.id)).toBe(false);
  });

  it("refuses a missing vehicle, a wrong file type, an unknown kind and a file that does not exist", async () => {
    const { store } = fakeStore();
    await expect(addVehicleFile(d, store, mgr(), U(999), "photo", { name: "x.jpg", bytes: jpeg() })).rejects.toBeInstanceOf(UserError);
    await expect(addVehicleFile(d, store, mgr(), vehMine, "photo", { name: "x.exe", bytes: jpeg() })).rejects.toBeInstanceOf(UserError);
    await expect(addVehicleFile(d, store, mgr(), vehMine, "bogus" as never, { name: "x.jpg", bytes: jpeg() })).rejects.toBeInstanceOf(UserError);
    await expect(removeVehicleFile(d, store, mgr(), U(998))).rejects.toBeInstanceOf(UserError);
  });

  it("the database refuses a vehicle file for a vehicle that does not exist, or a path outside the tenant", async () => {
    const insert = (entity: string, path: string) => raw((q) => q.query("insert into attachments(entity_type, entity_id, storage_path, file_name) values ('vehicle', $1, $2, 'a.jpg')", [entity, path]));
    await expect(insert(U(997), `${t.schema}/vehicle/x/a.jpg`)).rejects.toThrow(/target not found/);
    await expect(insert(vehMine, `other_schema/vehicle/x/a.jpg`)).rejects.toThrow(/tenant folder/);
  });
});
