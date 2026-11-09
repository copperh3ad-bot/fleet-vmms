import { beforeAll, describe, expect, it } from "vitest";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { withTenant } from "@/lib/db/tenant";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import * as master from "@/lib/master/service";
import { phoneInOtherOrganization, PHONE_IN_OTHER_ORG } from "@/lib/phone-owner";

// ADR-082: one phone number belongs to one organization at a time.
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let A: { tenantId: string; schema: string }, B: { tenantId: string; schema: string };
const adminA = (): Membership => ({ ...A, userId: U(1), role: "tenant_admin", vehicleScope: "all" });
const adminB = (): Membership => ({ ...B, userId: U(2), role: "tenant_admin", vehicleScope: "all" });
const viewerB = (): Membership => ({ ...B, userId: U(3), role: "driver", vehicleScope: "all" });

beforeAll(async () => {
  d = await testDriver();
  A = await provisionTenant(d, { name: "One Org A", slug: "oneorga", ownerUserId: U(1), ownerName: "Owner A" }, tenantMigrations(), { transform: stripExt });
  B = await provisionTenant(d, { name: "One Org B", slug: "oneorgb", ownerUserId: U(2), ownerName: "Owner B" }, tenantMigrations(), { transform: stripExt });
});

describe("a phone number can belong to one organization at a time", () => {
  let first: string;
  it("an employee's number in one company is refused in another, in any spelling", async () => {
    first = (await master.saveEmployee(d, adminA(), { full_name: "Sana", employee_no: "S-1", phone: "0300 5551111" })).id;
    for (const phone of ["0300 5551111", "+92 300 5551111", "03005551111"]) {
      const e = await master.saveEmployee(d, adminB(), { full_name: "Same Number", employee_no: "X-1", phone }).catch((x) => x);
      expect(e.message).toBe(PHONE_IN_OTHER_ORG);
      expect(e.fields).toEqual({ phone: "Already registered with another organization" });
    }
    expect(await phoneInOtherOrganization(d, B.tenantId, "0300 5551111")).toBe(true);
    expect(await phoneInOtherOrganization(d, A.tenantId, "0300 5551111")).toBe(false);          // not "other" for the company that holds it
  });
  it("people of the same company may still share a number", async () => {
    await master.saveEmployee(d, adminA(), { full_name: "Sana's Brother", employee_no: "S-2", phone: "0300 5551111" });
  });
  it("an employee marked inactive releases the number", async () => {
    await master.saveEmployee(d, adminA(), { full_name: "Sana", employee_no: "S-1", phone: "0300 5551111", active: false }, first);
    const second = (await withTenant(d, adminA(), (q) => q.query<{ id: string }>("select id from employees where employee_no = 'S-2'"))).rows[0].id;
    await master.saveEmployee(d, adminA(), { full_name: "Sana's Brother", employee_no: "S-2", phone: "0300 5551111", active: false }, second);
    expect((await master.saveEmployee(d, adminB(), { full_name: "New Holder", employee_no: "X-2", phone: "0300 5551111" })).id).toBeTruthy();
  });
  it("a person without the permission learns nothing about other companies' numbers", async () => {
    expect(await master.saveEmployee(d, viewerB(), { full_name: "Nosy", employee_no: "X-3", phone: "0300 5551111" }).catch((x) => x)).toBeInstanceOf(ForbiddenError);
  });
});
