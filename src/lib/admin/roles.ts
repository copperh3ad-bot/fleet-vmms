// The administrator edits what each role may do, and makes roles of their own (ADR-097). Everything here needs admin.users (CLAUDE.md rule 3) and runs in the
// organization's own schema. Changes to role_permissions and roles are written to the audit trail by the database triggers.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Driver } from "@/lib/db/types";
import { authorized, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { fieldErrors } from "@/lib/master/schemas";
import { APPROVES, EDITABLE, VERIFIES } from "./permission-catalog";

export const MAX_CUSTOM_ROLES = 20;
export const isCustomKey = (key: string) => key.startsWith("custom_");

export type EditableRole = { key: string; name: string; builtin: boolean; locked: boolean; people: number; grants: string[] };

/** Every role with the permissions it holds and how many people hold it, for the editor. A workshop role is shown locked. */
export function listEditableRoles(driver: Driver, m: Membership): Promise<EditableRole[]> {
  return authorized(driver, m, "admin.users", async (q) => {
    const roles = (await q.query<{ key: string; name: string; is_builtin: boolean; is_external: boolean; people: number }>(
      `select r.key, r.name, r.is_builtin, r.is_external,
              (select count(*)::int from public.tenant_memberships mm where mm.tenant_id = $1 and mm.role = r.key and mm.status = 'active') as people
         from roles r order by case r.key when 'tenant_admin' then 0 when 'fleet_manager' then 1 when 'finance' then 2 when 'requester' then 3 when 'auditor' then 4 else 5 end, r.name`, [m.tenantId])).rows;
    const grants: Record<string, string[]> = {};
    for (const g of (await q.query<{ role_key: string; permission_key: string }>("select role_key, permission_key from role_permissions")).rows) (grants[g.role_key] ??= []).push(g.permission_key);
    return roles.map((r) => ({ key: r.key, name: r.name, builtin: r.is_builtin, locked: r.is_external, people: r.people, grants: grants[r.key] ?? [] }));
  });
}

const nameField = z.string().trim().min(2, "Give the role a name of at least 2 characters").max(40, "At most 40 characters").regex(/^[\p{L}\p{N} &'().,/-]+$/u, "Letters, numbers and simple punctuation only");

/** One change at a time per organization, so two administrators cannot undo each other half-way. */
const lock = (q: import("@/lib/db/types").Queryable, tenantId: string) => q.query("select 1 from public.tenants where id = $1 for update", [tenantId]);

function checkSeparation(roleKey: string, perms: string[]) {
  if (roleKey === "tenant_admin") return;             // ADR-077: the administrator holds both, under the rules for deciding one's own items
  if (perms.some((p) => APPROVES.includes(p)) && perms.some((p) => VERIFIES.includes(p)))
    throw new UserError("A role cannot both approve a job card or quotation and verify the invoice for it. Give those to different roles.", { perms: "Untick one of the two" });
}

/** Replace the editable permissions of one role with exactly this list. Permissions the screen never hands out (people management, the workshop's own) are left as they are. */
export function setRolePermissions(driver: Driver, m: Membership, roleKey: string, requested: string[]): Promise<{ added: number; removed: number }> {
  return authorized(driver, m, "admin.users", async (q) => {
    await lock(q, m.tenantId);
    const role = (await q.query<{ is_external: boolean }>("select is_external from roles where key = $1", [roleKey])).rows[0];
    if (!role) throw new UserError("Unknown role.");
    if (role.is_external) throw new UserError("The workshop role cannot be changed here.");
    const want = [...new Set(requested)];
    const bad = want.filter((p) => !EDITABLE.has(p));
    if (bad.length) throw new UserError("One of those permissions cannot be given from here.", { perms: "Choose from the list" });
    checkSeparation(roleKey, want);
    const have = (await q.query<{ permission_key: string }>("select permission_key from role_permissions where role_key = $1", [roleKey])).rows.map((r) => r.permission_key).filter((p) => EDITABLE.has(p));
    const add = want.filter((p) => !have.includes(p));
    const drop = have.filter((p) => !want.includes(p));
    if (drop.length) await q.query("delete from role_permissions where role_key = $1 and permission_key = any($2::text[])", [roleKey, drop]);
    if (add.length) await q.query("insert into role_permissions(role_key, permission_key) select $1, p from unnest($2::text[]) p on conflict do nothing", [roleKey, add]);
    return { added: add.length, removed: drop.length };
  });
}

/** A new role of the organization's own, empty or starting from what another role may do. */
export function createRole(driver: Driver, m: Membership, input: { name: string; copy_from?: string }): Promise<{ key: string }> {
  const r = z.object({ name: nameField, copy_from: z.string().max(40).optional() }).safeParse({ name: input.name, copy_from: input.copy_from?.trim() || undefined });
  if (!r.success) return Promise.reject(new UserError("Fix the highlighted fields.", fieldErrors(r.error)));
  return authorized(driver, m, "admin.users", async (q) => {
    await lock(q, m.tenantId);
    if ((await q.query<{ c: number }>("select count(*)::int c from roles where not is_builtin")).rows[0].c >= MAX_CUSTOM_ROLES) throw new UserError(`An organization can have at most ${MAX_CUSTOM_ROLES} roles of its own.`);
    if ((await q.query("select 1 from roles where lower(name) = lower($1)", [r.data.name])).rows.length) throw new UserError("A role with that name already exists.", { name: "Choose another name" });
    const key = `custom_${randomBytes(4).toString("hex")}`;
    let start: string[] = [];
    if (r.data.copy_from) {
      const src = (await q.query<{ is_external: boolean }>("select is_external from roles where key = $1", [r.data.copy_from])).rows[0];
      if (!src || src.is_external) throw new UserError("Choose a role to start from.", { copy_from: "Choose a role" });
      start = (await q.query<{ permission_key: string }>("select permission_key from role_permissions where role_key = $1", [r.data.copy_from])).rows.map((x) => x.permission_key).filter((p) => EDITABLE.has(p));
      if (start.some((p) => APPROVES.includes(p))) start = start.filter((p) => !VERIFIES.includes(p));   // copied from the administrator: the one role allowed to hold both, so the copy leaves verifying out
    }
    await q.query("insert into roles(key, name, is_external, is_builtin) values ($1, $2, false, false)", [key, r.data.name]);
    if (start.length) await q.query("insert into role_permissions(role_key, permission_key) select $1, p from unnest($2::text[]) p on conflict do nothing", [key, start]);
    return { key };
  });
}

export function renameRole(driver: Driver, m: Membership, roleKey: string, name: string): Promise<void> {
  const r = nameField.safeParse(name);
  if (!r.success) return Promise.reject(new UserError(r.error.issues[0].message, { name: r.error.issues[0].message }));
  return authorized(driver, m, "admin.users", async (q) => {
    await lock(q, m.tenantId);
    const role = (await q.query<{ is_builtin: boolean }>("select is_builtin from roles where key = $1", [roleKey])).rows[0];
    if (!role) throw new UserError("Unknown role.");
    if (role.is_builtin) throw new UserError("A built-in role keeps its name.");
    if ((await q.query("select 1 from roles where lower(name) = lower($1) and key <> $2", [r.data, roleKey])).rows.length) throw new UserError("A role with that name already exists.", { name: "Choose another name" });
    await q.query("update roles set name = $2 where key = $1", [roleKey, r.data]);
  });
}

/** Only a role of the organization's own, and only when nobody holds it and no invitation names it. */
export function deleteRole(driver: Driver, m: Membership, roleKey: string): Promise<void> {
  return authorized(driver, m, "admin.users", async (q) => {
    await lock(q, m.tenantId);
    const role = (await q.query<{ is_builtin: boolean }>("select is_builtin from roles where key = $1", [roleKey])).rows[0];
    if (!role) throw new UserError("Unknown role.");
    if (role.is_builtin) throw new UserError("A built-in role cannot be deleted.");
    const used = (await q.query<{ c: number }>(
      `select (select count(*) from public.tenant_memberships where tenant_id = $1 and role = $2)
            + (select count(*) from public.invitations where tenant_id = $1 and role_key = $2 and accepted_at is null and revoked_at is null) as c`, [m.tenantId, roleKey])).rows[0].c;
    if (Number(used) > 0) throw new UserError("Someone still holds this role or has an invitation for it. Move them to another role first.");
    await q.query("delete from roles where key = $1", [roleKey]);
  });
}
