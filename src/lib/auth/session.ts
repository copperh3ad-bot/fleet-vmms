import { cache } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getDriver } from "@/lib/db";
import { loadAccess } from "@/lib/billing/state";
import { isOperator } from "@/lib/billing/operator";
import { findActiveTenant, membershipIn, type Membership } from "./can";

// A page, its layout and the actions it runs all ask "who is this" and "which workspace". cache() makes each of those
// one lookup per request instead of one per caller; every request still checks for itself.
const currentUser = cache(async () => {
  await connection(); // per-request work (token check, DB) must not be prerendered
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();       // asks Supabase, so a revoked or disabled login stops at once
  return data.user;
});
const tenantBySlug = cache((slug: string) => findActiveTenant(getDriver(), slug));
const accessOf = cache((tenantId: string) => loadAccess(getDriver(), tenantId));
const membershipOf = cache(async (slug: string, userId: string) => {
  const t = await tenantBySlug(slug);
  if (!t) return { m: null, billing: null };
  // The member's role (the organization's own database) and the billing state (control plane) do not depend on each other.
  const [m, billing] = await Promise.all([membershipIn(getDriver(), t, userId), accessOf(t.id)]);
  return { m, billing };
});

/** The signed-in user, verified with Supabase. Redirects to /login if there is none. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * The signed-in user's role in this workspace. A non-member gets a 404-style redirect, never a hint the workspace exists.
 * A locked organization (trial over, payment overdue, suspended) is sent to its billing page instead of the page it
 * asked for. Only the billing page, the layout around it and the data export pass allowLocked. Every server action starts
 * here too (runAction), so a locked organization cannot change anything.
 */
export async function requireMembership(slug: string, opts: { allowLocked?: boolean } = {}): Promise<Membership> {
  const user = await requireUser();
  const { m, billing } = await membershipOf(slug, user.id);
  if (!m || !billing) redirect("/");
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
