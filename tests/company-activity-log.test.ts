import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withPlatform, withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import * as jc from "@/lib/jobcards/service";
import { saveDepot } from "@/lib/depots/service";
import { listCompanyActivity, tableLabel } from "@/lib/activity/company-log";

// Owner decisions I2 (a company reads its own activity log, read-only, for the auditor) and I3 (a workshop acting through a link is named in the history).
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });
const owner = () => mem("tenant_admin", 1);
const raw = <T,>(fn: (q: import("@/lib/db/types").Queryable) => Promise<T>) => withTenant(d, owner(), fn);

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Log Co", slug: "logco", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
  await withPlatform(d, async (q) => {
    for (const [n, role] of [[91, "requester"], [92, "fleet_manager"], [94, "auditor"], [95, "finance"]] as const)
      await q.query("insert into public.tenant_memberships(user_id, tenant_id, role) values ($1, $2, $3)", [U(n), t.tenantId, role]);
  });
  const fmEmp = (await master.saveEmployee(d, owner(), { full_name: "Fatima Manager", employee_no: "E-92" })).id;
  await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(92), fmEmp]));
});

describe("the company activity log", () => {
  it("is read by the administrator and the auditor, and by nobody else", async () => {
    expect((await listCompanyActivity(d, owner())).rows).toBeDefined();
    expect((await listCompanyActivity(d, mem("auditor", 94))).rows).toBeDefined();
    for (const who of [mem("fleet_manager", 92), mem("requester", 91), mem("finance", 95)]) await expect(listCompanyActivity(d, who)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("says who did what, names the fields that changed and never shows their values", async () => {
    await saveDepot(d, mem("fleet_manager", 92), { name: "Quetta yard", city: "Quetta", kind: "yard" });
    const depot = (await raw((q) => q.query<{ id: string }>("select id from depots where name = 'Quetta yard'"))).rows[0];
    await raw((q) => q.query("select set_config('app.user_id', $1, true)", [U(92)]).then(() => q.query("update depots set city = 'Zhob SECRETCITY' where id = $1", [depot.id])));
    const { rows, tables } = await listCompanyActivity(d, mem("auditor", 94), { table: "depots" });
    expect(tables).toContain("depots");
    const added = rows.find((r) => r.action === "INSERT" && r.row_id === depot.id)!;
    expect(added.actor_name).toBe("Fatima Manager");
    const changed = rows.find((r) => r.action === "UPDATE" && r.row_id === depot.id)!;
    expect(changed.changed).toEqual(["city"]);
    expect(JSON.stringify(rows)).not.toContain("SECRETCITY");           // field names only, no values
    expect(tableLabel("job_cards")).toBe("Job cards");
    expect(tableLabel("export:cargo")).toBe("Export: cargo");
  });

  it("is a page for people who hold the permission, and appears in the menu for them only", () => {
    const layout = readFileSync("src/app/w/[slug]/layout.tsx", "utf8");
    expect(layout).toMatch(/\/activity.*activity\.read/);
    const roles = readFileSync("docs/RBAC-MATRIX.md", "utf8");
    expect(roles).toContain("activity.read");
  });
});

describe("a workshop acting through a link is named in the card history (I3)", () => {
  it("shows Workshop (link) for a single workshop, and does not guess when several were asked", async () => {
    const veh = (await master.addVehicle(d, owner(), { registration_no: "LNK-001", make: "Toyota", model: "Hilux" })).id;
    const reason = (await raw(async (q) => (await q.query<{ id: string }>("select id from reason_codes where code = 'WEAR_BRAKES'")).rows[0])).id;
    const emp = (await master.saveEmployee(d, owner(), { full_name: "Requester One", employee_no: "E-91" })).id;
    await raw((q) => q.query("update employees set user_id = $1 where id = $2", [U(91), emp]));
    const card = await jc.createJobCard(d, mem("requester", 91), { vehicle_id: veh, requested_by: emp, reason_code_id: reason, cause_text: "Brake pads worn out, needs work", lines: [{ kind: "part", description: "Pads", qty: "1", unit_cost: "1000" }] }, true);
    const vendor = (await master.saveVendor(d, owner(), { name: "Quick Fix Motors" })).id;
    await raw((q) => q.query("update job_cards set vendor_id = $1 where id = $2", [vendor, card.id]));
    await raw((q) => q.query("insert into job_card_events(job_card_id, from_status, to_status, actor_id, comment) values ($1, 'vendor_assigned', 'quotation_received', null, 'Estimate sent by the workshop through a link')", [card.id]));
    const names = async () => (await jc.getJobCard(d, owner(), card.id))!.events.map((e) => e.actor_name);
    expect(await names()).toContain("Quick Fix Motors (link)");
    await raw((q) => q.query("insert into job_card_invitees(job_card_id, vendor_id) values ($1, $2)", [card.id, vendor]));
    const after = await names();
    expect(after).toContain("A workshop (link)");
    expect(after).not.toContain("Quick Fix Motors (link)");
  });
});
