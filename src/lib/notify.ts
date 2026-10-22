// Notifications are rows in the tenant's notifications table, written in the same transaction as the change that
// caused them, so a notice never exists without its cause and a change never loses its notice.
import type { Queryable } from "@/lib/db/types";

export async function notify(q: Queryable, userIds: (string | null | undefined)[], kind: string, payload: Record<string, unknown>, except: string) {
  const ids = [...new Set(userIds.filter((u): u is string => !!u && u !== except))];
  for (const id of ids) await q.query("insert into notifications(user_id, kind, payload) values ($1, $2, $3::jsonb)", [id, kind, JSON.stringify(payload)]);
}

/** Active members of this workspace whose role holds the permission. */
export async function usersWithPermission(q: Queryable, tenantId: string, permission: string): Promise<string[]> {
  return (await q.query<{ user_id: string }>(
    `select m.user_id from public.tenant_memberships m
      where m.tenant_id = $1 and m.status = 'active'
        and m.role in (select role_key from role_permissions where permission_key = $2)`, [tenantId, permission])).rows.map((r) => r.user_id);
}
