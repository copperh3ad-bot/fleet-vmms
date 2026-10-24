// Sign-in names for people with no email (ADR-025). A person invited without an email is given a short name to sign in with.
// Supabase still wants an email, so behind the scenes they get a made-up address on a domain that has no mailbox; nothing is
// ever sent there (the email hook refuses it), and it is never shown. This module owns the rules for names and the control-plane
// table that links a name to that address.
import { randomBytes } from "node:crypto";
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";

import { LOGIN_EMAIL_DOMAIN, normalizeUsername } from "./username";
export * from "./username";

export const newLoginEmail = () => `u${randomBytes(12).toString("hex")}@${LOGIN_EMAIL_DOMAIN}`;

// ----------------------------------------------------------------------------------------------- the control-plane table

export async function loginEmailFor(driver: Driver, username: string): Promise<string | null> {
  return withPlatform(driver, async (q) => (await q.query<{ login_email: string }>("select login_email from public.login_names where username = $1", [normalizeUsername(username)])).rows[0]?.login_email ?? null);
}

export async function usernameTaken(driver: Driver, username: string): Promise<boolean> {
  return withPlatform(driver, async (q) => (await q.query("select 1 from public.login_names where username = $1", [normalizeUsername(username)])).rows.length > 0);
}

export type LoginName = { username: string; userId: string; loginEmail: string; invitationId: string | null };

export async function loginNameByUsername(driver: Driver, username: string): Promise<LoginName | null> {
  return withPlatform(driver, async (q) =>
    (await q.query<{ username: string; user_id: string; login_email: string; invitation_id: string | null }>("select username, user_id, login_email, invitation_id from public.login_names where username = $1", [normalizeUsername(username)])).rows
      .map((r) => ({ username: r.username, userId: r.user_id, loginEmail: r.login_email, invitationId: r.invitation_id }))[0] ?? null);
}

export async function loginNameByUserId(driver: Driver, userId: string): Promise<LoginName | null> {
  return withPlatform(driver, async (q) =>
    (await q.query<{ username: string; user_id: string; login_email: string; invitation_id: string | null }>("select username, user_id, login_email, invitation_id from public.login_names where user_id = $1", [userId])).rows
      .map((r) => ({ username: r.username, userId: r.user_id, loginEmail: r.login_email, invitationId: r.invitation_id }))[0] ?? null);
}

export async function loginNamesFor(driver: Driver, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  return withPlatform(driver, async (q) =>
    new Map((await q.query<{ user_id: string; username: string }>("select user_id, username from public.login_names where user_id = any($1::uuid[])", [userIds])).rows.map((r) => [r.user_id, r.username])));
}

/** Links a name to a person. A name that is already taken is a plain message, so two people cannot end up with one name. */
export async function recordLoginName(driver: Driver, n: LoginName): Promise<void> {
  try {
    await withPlatform(driver, (q) => q.query("insert into public.login_names(username, user_id, login_email, invitation_id) values ($1, $2, $3, $4)", [n.username, n.userId, n.loginEmail, n.invitationId]));
  } catch (e) {
    if (e instanceof Error && /login_names_pkey|duplicate key/.test(e.message)) throw new UserError("That sign-in name was taken a moment ago. Ask your administrator for a new invitation with another name.");
    throw e;
  }
}
