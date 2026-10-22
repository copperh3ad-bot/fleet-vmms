// A vehicle's photo and a scan of its registration book. Stored as attachments of kind "vehicle"; the kind of file is
// the start of the stored name. Needs vehicle.write to add or remove, vehicle.read to see (and, for a person limited to
// their own vehicle, only the vehicle they hold).
import type { Driver } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";
import { deleteAttachment, listAttachments, saveAttachment, type AttachmentRow, type BlobStore } from "@/lib/jobcards/attachments";
import { UserError } from "@/lib/master/service";

export const VEHICLE_FILE_KINDS = { photo: "vehicle-photo", registration: "registration-scan" } as const;
export type VehicleFileKind = keyof typeof VEHICLE_FILE_KINDS;
export type VehicleFile = AttachmentRow & { kind: VehicleFileKind | "other" };

const kindOf = (name: string): VehicleFile["kind"] =>
  name.startsWith(`${VEHICLE_FILE_KINDS.photo}_`) ? "photo" : name.startsWith(`${VEHICLE_FILE_KINDS.registration}_`) ? "registration" : "other";

export function addVehicleFile(driver: Driver, store: BlobStore, m: Membership, vehicleId: string, kind: VehicleFileKind, file: { name: string; bytes: Uint8Array }): Promise<void> {
  if (!(kind in VEHICLE_FILE_KINDS)) return Promise.reject(new UserError("Unknown kind of file."));
  return authorized(driver, m, "vehicle.write", async (q) => {
    if ((await q.query("select 1 from vehicles where id = $1", [vehicleId])).rows.length === 0) throw new UserError("Vehicle not found.");
    await saveAttachment(q, store, m, "vehicle", vehicleId, { name: `${VEHICLE_FILE_KINDS[kind]}_${file.name}`, bytes: file.bytes });
  });
}

export function listVehicleFiles(driver: Driver, store: BlobStore, m: Membership, vehicleId: string): Promise<VehicleFile[]> {
  return authorized(driver, m, "vehicle.read", async (q) => {
    if (m.vehicleScope === "own") {
      const mine = await q.query(
        `select 1 from vehicle_custody c join employees e on e.id = c.employee_id where c.vehicle_id = $1 and c.to_date is null and e.user_id = $2`, [vehicleId, m.userId]);
      if (mine.rows.length === 0) return [];
    }
    return (await listAttachments(q, store, m, "vehicle", vehicleId)).map((f) => ({ ...f, kind: kindOf(f.file_name) }));
  });
}

export function removeVehicleFile(driver: Driver, store: BlobStore, m: Membership, attachmentId: string): Promise<void> {
  return authorized(driver, m, "vehicle.write", async (q) => {
    const row = (await q.query<{ entity_type: string }>("select entity_type from attachments where id = $1", [attachmentId])).rows[0];
    if (!row || row.entity_type !== "vehicle") throw new UserError("File not found.");
    await deleteAttachment(q, store, m, attachmentId);
  });
}
