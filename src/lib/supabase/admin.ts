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
  if (!res.ok) throw new Error(`storage upload failed: ${await reason(res)}`);
}

// ---- Files (ADR-025, amended): every read, write and delete of an organization's files goes through here, on the server.
// Browsers hold no storage rights at all (control migration 0020), so a person's own login token cannot reach the bucket. Who may touch which
// folder is decided in src/lib/supabase/blob-store.ts before any of these is called; the path shape is checked again here.
const PATH = /^tenant_[a-z0-9_]{1,50}\/[A-Za-z0-9._\/-]{1,300}$/;
function storageConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new UserError("File storage is not switched on yet.");
  return { base: `${url.replace(/\/+$/, "")}/storage/v1`, key };
}
const objectPath = (path: string) => {
  if (!PATH.test(path) || path.includes("..") || path.includes("//")) throw new Error("storage path refused");
  return path.split("/").map(encodeURIComponent).join("/");
};
/** Supabase's own short reason for a refusal (for example "signature verification failed"), so a bad key is named, not guessed at. */
async function reason(res: Response): Promise<string> {
  const j = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
  return `${res.status} ${String(j.message ?? j.error ?? "").slice(0, 120)}`.trim();
}
const storageFetch = (c: { key: string }, url: string, init: RequestInit & { headers?: Record<string, string> }) =>
  fetch(url, { ...init, headers: { apikey: c.key, authorization: `Bearer ${c.key}`, ...init.headers }, signal: AbortSignal.timeout(20_000), cache: "no-store" });

export async function storagePut(path: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const c = storageConfig();
  const res = await storageFetch(c, `${c.base}/object/attachments/${objectPath(path)}`, { method: "POST", headers: { "content-type": contentType, "x-upsert": "false" }, body: Buffer.from(bytes) });
  if (!res.ok) throw new Error(`storage upload failed: ${await reason(res)}`);
}
export async function storageGet(path: string): Promise<Uint8Array | null> {
  const c = storageConfig();
  const res = await storageFetch(c, `${c.base}/object/attachments/${objectPath(path)}`, { method: "GET" });
  return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
}
export async function storageRemove(path: string): Promise<void> {
  const c = storageConfig();
  objectPath(path);
  const res = await storageFetch(c, `${c.base}/object/attachments`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ prefixes: [path] }) });
  if (!res.ok) throw new Error(`storage remove failed: ${await reason(res)}`);
}
export async function storageSignedUrl(path: string, seconds: number): Promise<string | null> {
  const c = storageConfig();
  const res = await storageFetch(c, `${c.base}/object/sign/attachments/${objectPath(path)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ expiresIn: Math.max(1, Math.min(3600, Math.floor(seconds))) }) });
  if (!res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { signedURL?: string };
  return j.signedURL ? `${c.base}${j.signedURL.startsWith("/") ? "" : "/"}${j.signedURL}` : null;
}

/**
 * A self-test of file storage with the key this server really has: save, read back, make a link, delete, and confirm it is gone. Run from Admin, Settings. It writes one
 * tiny file under a folder no company can reach and removes it. Each step says how it went; the key and the file are never shown.
 */
export async function checkStorage(): Promise<{ step: string; ok: boolean; note: string }[]> {
  const out: { step: string; ok: boolean; note: string }[] = [];
  const run = async (step: string, f: () => Promise<string>) => {
    try { out.push({ step, ok: true, note: await f() }); } catch (e) { out.push({ step, ok: false, note: e instanceof Error ? e.message.slice(0, 160) : "failed" }); }
  };
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  out.push({ step: "The server has a storage key", ok: key.length > 0, note: key.length ? "set" : "SUPABASE_SERVICE_ROLE_KEY is not set on this server" });
  if (!key) return out;
  const path = `tenant_healthcheck/${Date.now()}.txt`;
  const body = new TextEncoder().encode("fleet otg storage check");
  await run("Save a file", async () => { await storagePut(path, body, "text/plain"); return "saved"; });
  if (!out[out.length - 1].ok) return out;
  await run("Read it back", async () => { const b = await storageGet(path); return b && new TextDecoder().decode(b) === "fleet otg storage check" ? "same bytes" : (() => { throw new Error("did not come back"); })(); });
  await run("Make a link to it", async () => { const u = await storageSignedUrl(path, 60); if (!u) throw new Error("no link was made"); return "made"; });
  await run("Delete it", async () => { await storageRemove(path); return "deleted"; });
  await run("Confirm it is gone", async () => { if ((await storageGet(path)) !== null) throw new Error("still there"); return "gone"; });
  return out;
}
