// Depots and places (ADR-093, owner decision F5). A list each organization keeps for itself; forms offer it as suggestions for a place.
import { z } from "zod";
import type { Driver } from "@/lib/db/types";
import { authorized, authorizedAny, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";

export const DEPOT_KINDS: Record<string, string> = { depot: "Depot", office: "Office", yard: "Yard", port: "Port", workshop: "Workshop", site: "Site", other: "Other" };
const blank = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);

export const depotSchema = z.object({
  name: z.string().trim().min(2, "Enter the name of the place").max(80),
  city: z.preprocess(blank, z.string().trim().max(80).optional()),
  kind: z.enum(Object.keys(DEPOT_KINDS) as [string, ...string[]], "Choose the kind of place").default("depot"),
});

export type Depot = { id: string; name: string; city: string | null; kind: string; active: boolean; vehicles: number };

/** Anyone who picks a place on a form may read the list; managing it needs depot.manage. */
const READERS = ["depot.manage", "vehicle.write", "cargo.request", "cargo.handle", "trip.request", "trip.approve", "vreq.assign"];

export function listDepots(driver: Driver, m: Membership, opts: { activeOnly?: boolean } = {}): Promise<Depot[]> {
  return authorizedAny(driver, m, READERS, async (q) => (await q.query<Depot>(
    `select d.id, d.name, d.city, d.kind, d.active,
            (select count(*)::int from vehicles v where v.status <> 'disposed' and lower(trim(v.base_location)) = lower(trim(d.name))) as vehicles
       from depots d ${opts.activeOnly ? "where d.active" : ""} order by d.active desc, lower(d.name)`)).rows);
}

/** The names only, for a form's suggestions. A person who cannot read the list simply gets no suggestions. */
export async function depotNames(driver: Driver, m: Membership): Promise<string[]> {
  try { return (await listDepots(driver, m, { activeOnly: true })).map((d) => d.name); }          // the name alone, so a place saved from a suggestion matches the depot exactly
  catch { return []; }
}

export async function saveDepot(driver: Driver, m: Membership, raw: unknown, id?: string): Promise<void> {
  const p = depotSchema.safeParse(raw);
  return authorized(driver, m, "depot.manage", async (q) => {
    if (!p.success) throw new UserError("Fix the highlighted fields.", fieldErrors(p.error));
    const d = p.data;
    const clash = (await q.query("select 1 from depots where lower(trim(name)) = lower(trim($1)) and ($2::uuid is null or id <> $2::uuid)", [d.name, id ?? null])).rows.length > 0;
    if (clash) throw new UserError("A place with this name is already on the list.", { name: "Already on the list" });
    if (id) {
      const r = await q.query("update depots set name = $2, city = $3, kind = $4 where id = $1 returning id", [id, d.name, d.city ?? null, d.kind]);
      if (r.rows.length === 0) throw new UserError("Place not found.");
    } else {
      await q.query("insert into depots(name, city, kind, created_by) values ($1,$2,$3,$4)", [d.name, d.city ?? null, d.kind, m.userId]);
    }
  });
}

export function setDepotActive(driver: Driver, m: Membership, id: string, active: boolean): Promise<void> {
  return authorized(driver, m, "depot.manage", async (q) => {
    const r = await q.query("update depots set active = $2 where id = $1 returning id", [id, active]);
    if (r.rows.length === 0) throw new UserError("Place not found.");
  });
}
