// File storage for the app (CLAUDE.md rule 2; ADR-025 amended). Files are read and written on the server only: browsers hold no storage rights, so a person's own login
// token cannot reach the bucket. This is where the old bucket policy now lives: a signed-in person may touch only the folders of the organizations they belong to
// (<schema>/...), and the platform operator may also read customers' payment receipts (<schema>/billing/...), nothing else.
import { supabaseServer } from "./server";
import { getDriver } from "@/lib/db";
import { withPlatform } from "@/lib/db/tenant";
import { storageGet, storagePut, storageRemove, storageSignedUrl } from "@/lib/supabase/admin";
import type { ReadableStore } from "@/lib/master/policy-reading";

export type Scope = { schemas: Set<string>; operator: boolean };

/** Which folders the signed-in person may use. Nobody signed in: none. */
async function scopeOfCaller(): Promise<Scope> {
  const sb = await supabaseServer();
  const { data } = await sb.auth.getUser();           // asks Supabase, so a revoked or disabled login stops at once
  if (!data.user) return { schemas: new Set(), operator: false };
  const id = data.user.id;
  return withPlatform(getDriver(), async (q) => {
    const rows = (await q.query<{ s: string }>("select t.schema_name as s from public.tenants t join public.user_orgs u on u.tenant_id = t.id where u.user_id = $1 and t.status = 'active'", [id])).rows;
    const op = (await q.query("select 1 from public.platform_admins where user_id = $1", [id])).rows.length > 0;
    return { schemas: new Set(rows.map((r) => r.s)), operator: op };
  });
}

/** May this scope use this path? Reading a payment receipt is the one thing an operator may do outside their own organizations. */
export function pathAllowed(scope: Scope, path: string, action: "read" | "write"): boolean {
  const [schema, kind] = path.split("/");
  if (!schema || path.includes("..")) return false;
  if (scope.schemas.has(schema)) return true;
  return action === "read" && scope.operator && kind === "billing";
}

export async function supabaseBlobStore(): Promise<ReadableStore> {
  let scope: Promise<Scope> | null = null;
  const guard = async (path: string, action: "read" | "write") => {
    scope ??= scopeOfCaller();
    if (!pathAllowed(await scope, path, action)) throw new Error("storage access refused");
  };
  return {
    async put(path, bytes, contentType) { await guard(path, "write"); await storagePut(path, bytes, contentType); },
    async remove(path) { await guard(path, "write"); await storageRemove(path); },
    async get(path) { try { await guard(path, "read"); } catch { return null; } return storageGet(path); },
    async signedUrl(path, seconds) { try { await guard(path, "read"); } catch { return null; } return storageSignedUrl(path, seconds); },
  };
}
