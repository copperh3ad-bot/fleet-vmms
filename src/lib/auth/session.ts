import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getDriver } from "@/lib/db";
import { resolveMembership, type Membership } from "./can";

/** The signed-in user, verified with Supabase. Redirects to /login if there is none. */
export async function requireUser() {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  return data.user;
}

/** The signed-in user's role in this workspace. A non-member gets a 404-style redirect, never a hint the workspace exists. */
export async function requireMembership(slug: string): Promise<Membership> {
  const user = await requireUser();
  const m = await resolveMembership(getDriver(), user.id, slug);
  if (!m) redirect("/");
  return m;
}
