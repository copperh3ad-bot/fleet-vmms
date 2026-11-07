// The control plane's index (ADR-014): which organization a link or an invitation belongs to, and which organizations a
// login can enter. The organization's own database stays the source of truth for who may do what; these rows only help
// a request find the right database. Losing one hides something or kills a link. It never grants access.
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { loadAccess } from "@/lib/billing/state";

export type TenantRef = { id: string; schema: string; slug: string; name: string };
export type TokenKind = "invite" | "odometer" | "quotation" | "invoice" | "reply" | "odoreply" | "joinconfirm";

const ref = (r: { id: string; schema_name: string; slug: string; name: string }): TenantRef => ({ id: r.id, schema: r.schema_name, slug: r.slug, name: r.name });

/** Remembers which organization a token belongs to. Expired routes are tidied now and then. */
export function routeToken(driver: Driver, kind: TokenKind, tenantId: string, tokenHash: string, expiresAt: string): Promise<void> {
  return withPlatform(driver, async (q) => {
    await q.query("insert into public.link_routes(token_hash, kind, tenant_id, expires_at) values ($1, $2, $3, $4) on conflict (token_hash) do nothing", [tokenHash, kind, tenantId, expiresAt]);
    if (Math.random() < 0.02) await q.query("delete from public.link_routes where expires_at < now() - interval '7 days'");
  });
}

export function unrouteToken(driver: Driver, tokenHash: string): Promise<void> {
  return withPlatform(driver, async (q) => { await q.query("delete from public.link_routes where token_hash = $1", [tokenHash]); });
}

/**
 * The active organization a live token belongs to, or null. A suspended or closed organization has no routes, and a
 * locked one (trial over, payment overdue) does not open links or take new members until it is paid up.
 */
export async function findTenantByToken(driver: Driver, kind: TokenKind, tokenHash: string): Promise<TenantRef | null> {
  const t = await withPlatform(driver, async (q) => {
    const r = (await q.query<{ id: string; schema_name: string; slug: string; name: string }>(
      `select t.id, t.schema_name, t.slug, t.name from public.link_routes r join public.tenants t on t.id = r.tenant_id
        where r.token_hash = $1 and r.kind = $2 and r.expires_at > now() and t.status = 'active' and t.provision_state = 'ready'`, [tokenHash, kind])).rows[0];
    return r ? ref(r) : null;
  });
  return t && (await loadAccess(driver, t.id)).full ? t : null;
}

export function indexInvitation(driver: Driver, tenantId: string, invitationId: string, email: string, expiresAt: string): Promise<void> {
  return withPlatform(driver, async (q) => {
    await q.query(
      `insert into public.invite_index(tenant_id, invitation_id, email, expires_at) values ($1, $2, lower($3), $4)
       on conflict (tenant_id, invitation_id) do update set email = excluded.email, expires_at = excluded.expires_at`, [tenantId, invitationId, email, expiresAt]);
  });
}

export function unindexInvitation(driver: Driver, tenantId: string, invitationId: string): Promise<void> {
  return withPlatform(driver, async (q) => { await q.query("delete from public.invite_index where tenant_id = $1 and invitation_id = $2", [tenantId, invitationId]); });
}

export function findTenantByInvitation(driver: Driver, invitationId: string): Promise<TenantRef | null> {
  return withPlatform(driver, async (q) => {
    const r = (await q.query<{ id: string; schema_name: string; slug: string; name: string }>(
      `select t.id, t.schema_name, t.slug, t.name from public.invite_index i join public.tenants t on t.id = i.tenant_id
        where i.invitation_id = $1 and t.status = 'active' and t.provision_state = 'ready'`, [invitationId])).rows[0];
    return r ? ref(r) : null;
  });
}

/** Organizations that have an open invitation for this address. The caller checks each one in its own database. */
export function tenantsInvitingEmail(driver: Driver, email: string): Promise<(TenantRef & { invitation_id: string })[]> {
  return withPlatform(driver, async (q) =>
    (await q.query<{ id: string; schema_name: string; slug: string; name: string; invitation_id: string }>(
      `select t.id, t.schema_name, t.slug, t.name, i.invitation_id from public.invite_index i join public.tenants t on t.id = i.tenant_id
        where i.email = lower($1) and i.expires_at > now() and t.status = 'active' and t.provision_state = 'ready' order by i.expires_at`, [email])).rows
      .map((r) => ({ ...ref(r), invitation_id: r.invitation_id })));
}

/** A login now belongs to an organization. Safe to repeat. */
export function rememberMember(driver: Driver, userId: string, tenantId: string): Promise<void> {
  return withPlatform(driver, async (q) => { await q.query("insert into public.user_orgs(user_id, tenant_id) values ($1, $2) on conflict do nothing", [userId, tenantId]); });
}

/** A login no longer belongs to an organization (it was disabled): it also loses access to the organization's files. */
export function forgetMember(driver: Driver, userId: string, tenantId: string): Promise<void> {
  return withPlatform(driver, async (q) => { await q.query("delete from public.user_orgs where user_id = $1 and tenant_id = $2", [userId, tenantId]); });
}
