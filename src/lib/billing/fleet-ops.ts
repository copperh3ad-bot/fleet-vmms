// Trip scheduling and cargo requests are part of the Pro plan (ADR-085): Basic is maintenance management, Pro is the whole fleet. The flag lives on the plan (features.fleet_ops),
// so no price is involved (CLAUDE.md rule 7). An organization with no plan row, and a plan that says nothing, keep the feature: only a plan that says false loses it.
import type { Driver, Queryable } from "@/lib/db/types";
import { authorized, authorizedAny, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { tenantPlan } from "./plans";

export const FLEET_OPS_MESSAGE = "Trip scheduling and cargo requests are part of the Pro plan. Your administrator can upgrade in Billing.";

export async function fleetOpsOn(driver: Driver, tenantId: string): Promise<boolean> {
  return (await tenantPlan(driver, tenantId)).fleetOps !== false;
}

export async function requireFleetOps(driver: Driver, m: { tenantId: string }): Promise<void> {
  if (!(await fleetOpsOn(driver, m.tenantId))) throw new UserError(FLEET_OPS_MESSAGE);
}

/** The entry points the trips and cargo services use instead of authorized(): the plan is checked first, outside any tenant transaction, then the permission as usual. */
export async function fleetAuthorized<T>(driver: Driver, m: Membership, permission: string, fn: (q: Queryable) => Promise<T>): Promise<T> {
  await requireFleetOps(driver, m);
  return authorized(driver, m, permission, fn);
}
export async function fleetAuthorizedAny<T>(driver: Driver, m: Membership, permissions: string[], fn: (q: Queryable, held: Set<string>) => Promise<T>): Promise<T> {
  await requireFleetOps(driver, m);
  return authorizedAny(driver, m, permissions, fn);
}
