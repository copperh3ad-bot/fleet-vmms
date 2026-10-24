// Real databases (only with TEST_DATABASE_URL): the control database and an organization's database are two separate
// Postgres databases on the same local server, reached through real connection pools and the real routing driver.
import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { secretBox } from "@/lib/crypto/secretbox";
import { pgDriver } from "@/lib/db/pg-driver";
import { routingDriver, type RoutingDriver } from "@/lib/db/router";
import { localProvider } from "@/lib/orgs/db-provider";
import { advanceProvisioning, startOrganization, type ProvisionDeps } from "@/lib/orgs/provision";
import { listWorkspaces, resolveMembership, type Membership } from "@/lib/auth/can";
import * as ad from "@/lib/admin/service";
import * as master from "@/lib/master/service";
import * as od from "@/lib/odometer/service";
import { lookupLink, submitViaLink } from "@/lib/odometer/link";
import { platformMigrations, tenantMigrations, testDriver } from "./helpers";

const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
const url = process.env.TEST_DATABASE_URL;
const box = secretBox(randomBytes(32));

describe.runIf(!!url)("an organization in its own real database", () => {
  let control: Awaited<ReturnType<typeof testDriver>>;
  let router: RoutingDriver;
  let m: Membership;
  let ref: string | undefined;
  const provider = localProvider(url ?? "postgres:///x");

  beforeAll(async () => {
    control = await testDriver();
    const d: ProvisionDeps = {
      control, provider: { ...provider, async create(i) { const db = await provider.create(i); ref = db.ref; return db; } },
      openDb: (u) => pgDriver(u, { max: 2 }), box, platformMigrations: platformMigrations(), tenantMigrations: tenantMigrations(),
      connectRetries: { tries: 5, delayMs: 200 },
    };
    const { tenantId, schema } = await startOrganization(d, { name: "Real Co", slug: "real-co", ownerUserId: U(1), ownerName: "Real Owner", ownerEmail: "real@example.com" });
    expect((await advanceProvisioning(d, tenantId, { budgetMs: 120_000 })).state).toBe("ready");
    router = routingDriver({ control, makeDriver: (u) => pgDriver(u, { max: 2 }), decrypt: box.decrypt });
    m = { tenantId, schema, userId: U(1), role: "tenant_admin", vehicleScope: "all", tenantName: "Real Co" };
  }, 180_000);

  afterAll(async () => {
    await router?.end();
    if (ref) await provider.destroy(ref);
    await (control as unknown as { end?(): Promise<void> }).end?.();
  });

  it("the organization's tables are in its own database and absent from the control database", async () => {
    const inControl = await control.transaction(async (q) => (await q.query("select 1 from information_schema.schemata where schema_name = $1", [m.schema])).rows);
    expect(inControl).toEqual([]);
    expect((await router.transaction(async (q) => (await q.query("select current_database() as db")).rows, { schema: m.schema }))[0]).toEqual({ db: ref });
    expect(await resolveMembership(router, U(1), "real-co")).toMatchObject({ role: "tenant_admin", tenantId: m.tenantId });
    expect(await listWorkspaces(router, U(1))).toEqual([{ slug: "real-co", name: "Real Co", role: "tenant_admin" }]);
  });

  it("existing services run on it: vehicles, invitations, and the open odometer link with the restricted database role", async () => {
    await master.addVehicle(router, m, { registration_no: "REAL-1", odometer_km: "500" });
    expect((await master.listVehicles(router, m)).map((v) => v.registration_no)).toEqual(["REAL-1"]);

    const inv = await ad.inviteUser(router, m, { full_name: "Real Manager", email: "manager@example.com", role: "fleet_manager", employee_no: "R-1" });
    expect(await ad.acceptInvitation(router, { token: inv.token }, { id: U(2), email: "manager@example.com", emailConfirmed: true })).toEqual({ slug: "real-co" });
    expect(await resolveMembership(router, U(2), "real-co")).toMatchObject({ role: "fleet_manager" });

    const cycle = await od.openCycle(router, m, "2026-10", "2026-10-30");
    const [link] = await od.createLinks(router, m, cycle);
    expect(await lookupLink(router, link.token)).toMatchObject({ plate: "REAL-1" });
    expect(await submitViaLink(router, link.token, "650")).toBe("ok");
    expect(await submitViaLink(router, link.token, "700")).toBe("invalid");
    // the link role really cannot read tables here
    await expect(router.transaction(async (q) => {
      await q.query(`set local search_path = "${m.schema}", public`);
      await q.query("set local role odometer_link");
      return q.query("select * from vehicles");
    }, { schema: m.schema })).rejects.toThrow(/permission denied/);
  });

  it("a wrong encryption key cannot open the organization's database", async () => {
    const wrong = routingDriver({ control, makeDriver: (u) => pgDriver(u, { max: 1 }), decrypt: secretBox(randomBytes(32)).decrypt });
    await expect(wrong.transaction((q) => q.query("select 1"), { schema: m.schema })).rejects.toThrow("Unreadable secret.");
    await wrong.end().catch(() => undefined);
  });
});
