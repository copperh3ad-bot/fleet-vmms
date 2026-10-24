// Sign-in names for people with no email (ADR-025). A person invited without an email is given a short name to sign in with.
// Supabase still wants an email, so behind the scenes they get a made-up address on a domain that has no mailbox; nothing is
// ever sent there (the email hook refuses it), and it is never shown. This module owns the rules for names and the control-plane
// table that links a name to that address, and the recovery code that keeps an administrator from taking over someone's login:
// a reset link only works together with a code that only the person knows, and only a hash of it is kept.
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";

import { LOGIN_EMAIL_DOMAIN, normalizeUsername } from "./username";
export * from "./username";

export const newLoginEmail = () => `u${randomBytes(12).toString("hex")}@${LOGIN_EMAIL_DOMAIN}`;

// ----------------------------------------------------------------------------------------------- the recovery code

/** Digits only, so it is easy to remember and to type on a phone. Wrong tries are limited, so six digits is enough. */
export const RECOVERY_RE = /^[0-9]{6,12}$/;

export function checkRecoveryCode(raw: string): { ok: true; code: string } | { ok: false; message: string } {
  const code = raw.replace(/\s+/g, "");
  if (!RECOVERY_RE.test(code)) return { ok: false, message: "Choose a recovery code of 6 to 12 digits." };
  if (/^(\d)\1+$/.test(code) || "01234567890123456789".includes(code) || "98765432109876543210".includes(code)) return { ok: false, message: "That recovery code is too easy to guess. Choose another." };
  return { ok: true, code };
}

/** Only a salted, deliberately slow hash is kept. The code itself is never stored or shown. */
export function hashRecoveryCode(code: string): string {
  const salt = randomBytes(16);
  return `s1$${salt.toString("hex")}$${scryptSync(code, salt, 32, { N: 16384, r: 8, p: 1 }).toString("hex")}`;
}

export function verifyRecoveryCode(code: string, stored: string | null): boolean {
  const [v, saltHex, hashHex] = (stored ?? "").split("$");
  if (v !== "s1" || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, "hex");
  const got = scryptSync(code.replace(/\s+/g, ""), Buffer.from(saltHex, "hex"), want.length, { N: 16384, r: 8, p: 1 });
  return got.length === want.length && timingSafeEqual(got, want);
}

// ----------------------------------------------------------------------------------------------- the control-plane table

export async function loginEmailFor(driver: Driver, username: string): Promise<string | null> {
  return withPlatform(driver, async (q) => (await q.query<{ login_email: string }>("select login_email from public.login_names where username = $1", [normalizeUsername(username)])).rows[0]?.login_email ?? null);
}

export async function usernameTaken(driver: Driver, username: string): Promise<boolean> {
  return withPlatform(driver, async (q) => (await q.query("select 1 from public.login_names where username = $1", [normalizeUsername(username)])).rows.length > 0);
}

export type LoginName = { username: string; userId: string; loginEmail: string; invitationId: string | null; recoveryHash: string | null };
type Row = { username: string; user_id: string; login_email: string; invitation_id: string | null; recovery_hash: string | null };
const toLoginName = (r: Row): LoginName => ({ username: r.username, userId: r.user_id, loginEmail: r.login_email, invitationId: r.invitation_id, recoveryHash: r.recovery_hash });
const COLUMNS = "username, user_id, login_email, invitation_id, recovery_hash";

export async function loginNameByUsername(driver: Driver, username: string): Promise<LoginName | null> {
  return withPlatform(driver, async (q) => (await q.query<Row>(`select ${COLUMNS} from public.login_names where username = $1`, [normalizeUsername(username)])).rows.map(toLoginName)[0] ?? null);
}

export async function loginNameByUserId(driver: Driver, userId: string): Promise<LoginName | null> {
  return withPlatform(driver, async (q) => (await q.query<Row>(`select ${COLUMNS} from public.login_names where user_id = $1`, [userId])).rows.map(toLoginName)[0] ?? null);
}

export async function loginNamesFor(driver: Driver, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  return withPlatform(driver, async (q) =>
    new Map((await q.query<{ user_id: string; username: string }>("select user_id, username from public.login_names where user_id = any($1::uuid[])", [userIds])).rows.map((r) => [r.user_id, r.username])));
}

/** Links a name to a person. A name that is already taken is a plain message, so two people cannot end up with one name. */
export async function recordLoginName(driver: Driver, n: LoginName): Promise<void> {
  try {
    await withPlatform(driver, (q) => q.query("insert into public.login_names(username, user_id, login_email, invitation_id, recovery_hash) values ($1, $2, $3, $4, $5)", [n.username, n.userId, n.loginEmail, n.invitationId, n.recoveryHash]));
  } catch (e) {
    if (e instanceof Error && /login_names_pkey|duplicate key/.test(e.message)) throw new UserError("That sign-in name was taken a moment ago. Ask your administrator for a new invitation with another name.");
    throw e;
  }
}

/** Used when a half-finished set-up is completed by the same invitation: the person chooses their code again. */
export async function setRecoveryHash(driver: Driver, userId: string, hash: string): Promise<void> {
  await withPlatform(driver, (q) => q.query("update public.login_names set recovery_hash = $2 where user_id = $1", [userId, hash]));
}

export async function deleteLoginName(driver: Driver, userId: string): Promise<void> {
  await withPlatform(driver, (q) => q.query("delete from public.login_names where user_id = $1", [userId]));
}
