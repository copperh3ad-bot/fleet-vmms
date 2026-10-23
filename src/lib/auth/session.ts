import { redirect } from "next/navigation";
import { connection } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getDriver } from "@/lib/db";
import { loadAccess } from "@/lib/billing/state";
import { isOperator } from "@/lib/billing/operator";
import { resolveMembership, type Membership } from "./can";

/** The signed-in user, verified with Supabase. Redirects to /login if there is none. */
export async function requireUser() {
  await connection(); // per-request work (token check, DB) must not be prerendered
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return data.user;
}

/**
 * The signed-in user's role in this workspace. A non-member gets a 404-style redirect, never a hint the workspace exists.
 * A locked organization (trial over, payment overdue, suspended) is sent to its billing page instead of the page it
 * asked for. Only the billing page, the layout around it and the data export pass allowLocked. Every server action starts
 * here too (runAction), so a locked organization cannot change anything.
 */
export async function requireMembership(slug: string, opts: { allowLocked?: boolean } = {}): Promise<Membership> {
  const user = await requireUser();
  const driver = getDriver();
  const m = await resolveMembership(driver, user.id, slug);
  if (!m) redirect("/");
  const billing = await loadAccess(driver, m.tenantId);
  if (!billing.full && !opts.allowLocked) redirect(`/w/${encodeURIComponent(slug)}/billing`);
  return { ...m, billing };
}

/**
 * The signed-in platform operator (the person in platform_admins who runs Fleet VMMS itself). Anyone else is sent to the
 * first page without a hint that the operator screen exists. Every operator action also checks this again inside the
 * database transaction that does the work.
 */
export async function requireOperator() {
  const user = await requireUser();
  if (!(await isOperator(getDriver(), user.id))) redirect("/");
  return user;
}
