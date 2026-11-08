import { cache } from "react";
import { forbidden, redirect } from "next/navigation";
import { connection } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getDriver } from "@/lib/db";
import { loadAccess } from "@/lib/billing/state";
import { isOperator } from "@/lib/billing/operator";
import { findActiveTenant, membershipIn, type Membership } from "./can";
import { logActivity } from "@/lib/activity/log";

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
/**
 * `fullScope` marks a page that is not for someone limited to their own vehicle (vehicle_scope "own"): they get the dashboard, the
 * job cards of their own vehicle and their notices, and every other page answers "not allowed", even by typing its address.
 * Workshops (role vendor) have their own pages and are not affected.
 */
export async function requireMembership(slug: string, opts: { allowLocked?: boolean; fullScope?: boolean } = {}): Promise<Membership> {
  const user = await requireUser();
  const { m, billing } = await membershipOf(slug, user.id);
  // The activity log (ADR-070): a refused visit is a security line; an allowed page view is one line per request however many layouts ask. A server action logs itself.
  if (!m || !billing) { await logRefusal(user.id, slug, "not a member"); redirect("/"); }
  if (!billing.full && !opts.allowLocked) { await logRefusal(user.id, slug, "workspace locked", m.tenantId, m.role); redirect(`/w/${encodeURIComponent(slug)}/billing`); }
  if (opts.fullScope && m.vehicleScope === "own" && m.role !== "vendor") { await logRefusal(user.id, slug, "own-vehicle scope", m.tenantId, m.role); forbidden(); }
  await logView(user.id, m.tenantId, m.role);
  return { ...m, billing };
}

const logView = cache(async (userId: string, tenantId: string, role: string) => {
  try {
    const { headers } = await import("next/headers");
    if ((await headers()).get("next-action")) return;            // an action logs itself
  } catch { return; }
  await logActivity({ kind: "page", name: "view", outcome: "ok", actorId: userId, tenantId, role });
});
async function logRefusal(userId: string, slug: string, why: string, tenantId?: string, role?: string) {
  await logActivity({ kind: "security", name: "workspace access refused", outcome: "denied", actorId: userId, tenantId: tenantId ?? null, role: role ?? null, details: { slug, why } });
}

/**
 * The signed-in platform operator (the person in platform_admins who runs Fleet OTG itself). Anyone else is sent to the
 * first page without a hint that the operator screen exists. Every operator action also checks this again inside the
 * database transaction that does the work.
 */
export async function requireOperator() {
  const user = await requireUser();
  if (!(await isOperator(getDriver(), user.id))) {
    await logActivity({ kind: "security", name: "operator area refused", outcome: "denied", actorId: user.id });
    redirect("/");
  }
  await logOperatorView(user.id);
  return user;
}

const logOperatorView = cache(async (userId: string) => {
  try {
    const { headers } = await import("next/headers");
    if ((await headers()).get("next-action")) return;            // an operator action logs itself
  } catch { return; }
  await logActivity({ kind: "page", name: "operator view", outcome: "ok", actorId: userId, role: "operator" });
});
