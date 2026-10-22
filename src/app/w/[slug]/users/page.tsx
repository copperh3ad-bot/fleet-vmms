import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { Card } from "@/components/form";
import { listInvitations, listMembers, listRoles, planUsage } from "@/lib/admin/service";
import { listVendors } from "@/lib/master/service";
import { InviteForm, MemberControls, PendingActions } from "./forms";

export default function UsersPage({ params }: PageProps<"/w/[slug]/users">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const usage = (u: { used: number; limit: number | null }) => (u.limit === null ? `${u.used}` : `${u.used} of ${u.limit}`);

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [members, invites, roles, use, vendors] = await Promise.all([
    listMembers(driver, m), listInvitations(driver, m), listRoles(driver, m), planUsage(driver, m), listVendors(driver, m).catch(() => []),
  ]);
  const roleOpts = roles.map((r) => [r.key, r.name] as [string, string]);
  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 p-4 text-zinc-900">
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="text-xl font-semibold">Users and roles</h1>
        <span className="text-sm text-zinc-600">{usage(use.users)} users{use.users.limit !== null && use.users.used >= use.users.limit ? " (limit reached)" : ""} · {usage(use.vehicles)} vehicles</span>
      </div>

      <Card title="Invite someone">
        <p className="mb-3 text-sm text-zinc-600">Nobody can join without an invitation. The person gets a link, creates their account with the email you enter, and is added with the role you choose. Workshops are invited here too, with the role “Vendor”.</p>
        <InviteForm slug={slug} roles={roleOpts} vendors={vendors.filter((v) => v.status === "active").map((v) => [v.id, v.name])} />
      </Card>

      {invites.length > 0 && (
        <Card title={`Waiting to join (${invites.length})`}>
          <ul className="divide-y divide-zinc-100 text-sm">
            {invites.map((i) => (
              <li key={i.id} className="space-y-1 py-2">
                <p><span className="font-medium">{i.full_name}</span> <span className="text-zinc-600">{i.email} · {i.role_name}{i.vendor_name ? ` · ${i.vendor_name}` : ""}</span></p>
                <p className={`text-xs ${i.expired ? "text-red-700" : "text-zinc-500"}`}>{i.expired ? "Expired" : `Link valid until ${new Date(i.expires_at).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" })}`}</p>
                <PendingActions slug={slug} id={i.id} />
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title={`People (${members.length})`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500"><tr><th className="py-1 pr-3">Name</th><th className="pr-3">Since</th><th>Access</th></tr></thead>
            <tbody>
              {members.map((p) => (
                <tr key={p.user_id} className={`border-t border-zinc-100 align-top ${p.status === "disabled" ? "text-zinc-500" : ""}`}>
                  <td className="py-2 pr-3"><span className="font-medium">{p.full_name ?? p.vendor_name ?? "Unnamed"}</span><span className="block text-xs text-zinc-500">{p.email ?? (p.vendor_name ? "Workshop login" : "")}</span></td>
                  <td className="py-2 pr-3 whitespace-nowrap">{p.since}</td>
                  <td className="py-2"><MemberControls slug={slug} userId={p.user_id} role={p.role} scope={p.vehicle_scope} status={p.status} roles={roleOpts} isMe={p.is_me} isVendor={p.role === "vendor"} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
