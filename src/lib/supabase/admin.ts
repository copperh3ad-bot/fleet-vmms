// The only place the app uses Supabase's service key (ADR-025). That key can create, change and delete any login, so it is used for
// exactly four things: for people who have no email, make their login (already confirmed, with the password they chose), change that
// password when an administrator has issued a reset link, and remove a login that was made but not finished; and (ADR-033) save one
// file that a workshop's email brought, because nobody is signed in when it arrives. It is read
// from the server's environment only, never sent to a browser, never logged, and never used to read or list people.
// tests/auth-admin-key.test.ts fails if any other file touches it.
import { UserError } from "@/lib/master/service";

const config = () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? { base: `${url.replace(/\/+$/, "")}/auth/v1/admin`, key } : null;
};

export const authAdminConfigured = () => config() !== null;

async function call(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const c = config();
  if (!c) throw new UserError("Sign-in names are not switched on yet. Ask the platform owner to finish the set-up.");
  const res = await fetch(`${c.base}${path}`, {
    method, headers: { "content-type": "application/json", apikey: c.key, authorization: `Bearer ${c.key}` },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10_000), cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

/** Makes a login with a made-up address and the chosen password, already confirmed. Returns its id. */
export async function createLoginUser(o: { email: string; password: string; fullName: string; username: string }): Promise<string> {
  const r = await call("POST", "/users", { email: o.email, password: o.password, email_confirm: true, user_metadata: { full_name: o.fullName, username: o.username } });
  if (r.status === 422 && /password/i.test(String(r.json.msg ?? r.json.message ?? ""))) throw new UserError("Choose a stronger password.");
  if (r.status < 200 || r.status >= 300 || typeof r.json.id !== "string") throw new UserError("The account could not be created. Try again, or ask for a new invitation.");
  return r.json.id;
}

export async function setLoginPassword(userId: string, password: string): Promise<void> {
  const r = await call("PUT", `/users/${encodeURIComponent(userId)}`, { password });
  if (r.status === 422) throw new UserError("Choose a stronger password.");
  if (r.status < 200 || r.status >= 300) throw new UserError("The password could not be changed. Try again, or ask for a new link.");
}

/** Cleans up a login made a moment ago whose set-up then failed. Failure is ignored: an orphan with an unknown address is harmless. */
export async function deleteLoginUser(userId: string): Promise<void> {
  await call("DELETE", `/users/${encodeURIComponent(userId)}`).catch(() => undefined);
}

/**
 * Saves one file a workshop emailed in (ADR-033), into the attachments bucket, at a path the caller has already built inside one
 * organization's own folder. Nobody is signed in when an email arrives, so the signed-in storage rules cannot apply. It only ever
 * adds a new file: it never overwrites, reads, lists or deletes.
 */
export async function putInboundFile(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new UserError("File storage is not switched on yet.");
  if (!/^tenant_[a-z0-9_]{1,50}\/[A-Za-z0-9._\/-]{1,300}$/.test(path) || path.includes("..")) throw new Error("storage path refused");
  const res = await fetch(`${url.replace(/\/+$/, "")}/storage/v1/object/attachments/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "POST", headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": contentType, "x-upsert": "false" },
    body: Buffer.from(bytes), signal: AbortSignal.timeout(15_000), cache: "no-store",
  });
  if (!res.ok) throw new Error(`storage upload failed: ${res.status}`);
}
