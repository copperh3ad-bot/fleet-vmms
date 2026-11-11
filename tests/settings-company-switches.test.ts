import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { testDriver, tenantMigrations, stripExt } from "./helpers";
import { provisionTenant } from "@/lib/db/provision";
import { ForbiddenError, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import * as ctl from "@/lib/control/service";

// QA-FULLFLOW F-03: the trips switch and the department approval limit were defined as settings an administrator may change, but no screen showed them.
// They now sit on the Service rules page ("Company switches").
const U = (n: number) => `00000000-0000-0000-0000-00000000${String(n).padStart(4, "0")}`;
let d: Awaited<ReturnType<typeof testDriver>>;
let t: { tenantId: string; schema: string };
const mem = (role: string, n: number): Membership => ({ ...t, userId: U(n), role, vehicleScope: "all" });

beforeAll(async () => {
  d = await testDriver();
  t = await provisionTenant(d, { name: "Switch Co", slug: "switchco", ownerUserId: U(1), ownerName: "Owner" }, tenantMigrations(), { transform: stripExt });
});

describe("the company switches on the Settings page", () => {
  it("the page shows both the trips switch and the department approval limit, and saves them with the other rules", () => {
    const page = readFileSync("src/app/w/[slug]/settings/page.tsx", "utf8");
    expect(page).toContain("module_trips");
    expect(page).toContain("dept_approval_limit");
    expect(page).toContain("Company switches");
    expect(page).toMatch(/SwitchFields/);
    const forms = readFileSync("src/app/w/[slug]/settings/rules-forms.tsx", "utf8");
    expect(forms).toMatch(/form="rules-form"/);      // joins the same form as the numbers, so "Save rules" saves it
  });

  it("an administrator can switch trips on and off and set and clear the limit; the stored values are what the rest of the app reads", async () => {
    const admin = mem("tenant_admin", 1);
    const view = async (key: string) => (await ctl.getSettings(d, admin)).find((s) => s.key === key)!;
    expect((await view("module_trips")).value).toBe("0");                 // off until switched on
    expect((await view("module_trips")).editable).toBe(true);
    expect(await ctl.saveSettings(d, admin, { module_trips: "1", dept_approval_limit: "250000" })).toBe(2);
    expect((await view("module_trips")).value).toBe("1");
    expect((await view("dept_approval_limit")).value).toBe("250000");
    expect(await ctl.saveSettings(d, admin, { module_trips: "0", dept_approval_limit: "" })).toBe(2);
    expect((await view("module_trips")).value).toBe("0");
    expect((await view("dept_approval_limit")).value).toBe("");            // blank means no limit
  });

  it("rejects values that are not allowed, and anyone without admin.settings can see the settings but not change them", async () => {
    const admin = mem("tenant_admin", 1);
    await expect(ctl.saveSettings(d, admin, { module_trips: "2" })).rejects.toBeInstanceOf(UserError);
    await expect(ctl.saveSettings(d, admin, { dept_approval_limit: "lots" })).rejects.toBeInstanceOf(UserError);
    for (const role of ["fleet_manager", "finance", "auditor"]) {
      const m = mem(role, 40);
      const s = (await ctl.getSettings(d, m)).find((x) => x.key === "module_trips");
      if (s) expect(s.editable).toBe(false);
      await expect(ctl.saveSettings(d, m, { module_trips: "1" })).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});
