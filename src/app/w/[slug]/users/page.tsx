import { dmy } from "@/lib/format/date";
import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { PageHeader, Panel, Pill, btnPrimary, type Tone } from "@/components/ui";
import { getRoleMatrix, listInvitations, listMembers, listRoleDepartments, listRoles, planUsage } from "@/lib/admin/service";
import { listVendors } from "@/lib/master/service";
import { listEditableRoles, MAX_CUSTOM_ROLES } from "@/lib/admin/roles";
import { RolesPanel } from "./roles-panel";
import { plural } from "@/lib/labels";
import { getJoinCode, listJoinRequests } from "@/lib/orgs/join";
import { getLearnerAllowed } from "@/lib/compliance/licences";
import { origin } from "@/lib/origin";
import { InviteForm, MemberControls, PendingActions, ReplaceLogin, ResetLink } from "./forms";
import { JoinCodePanel, JoinRequestActions } from "./join-forms";

export default function UsersPage({ params, searchParams }: PageProps<"/w/[slug]/users">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const usage = (u: { used: number; limit: number | null }) => (u.limit === null ? `${u.used}` : `${u.used} of ${u.limit}`);

// What the read-only table lists: a plain sentence and the permissions that give it. Anything that holds one of them gets a Yes.
const CAPABILITIES: [string, string[]][] = [
  ["Raise a job card", ["jobcard.create"]],
  ["Approve a job card", ["jobcard.approve"]],
  ["Choose the workshop", ["jobcard.assign_vendor"]],
  ["Approve a quotation", ["quotation.approve"]],
  ["Verify an invoice", ["invoice.verify"]],
  ["Review odometer readings", ["odometer.review"]],
  ["Edit budgets", ["budget.manage"]],
  ["Edit service rules", ["service.manage"]],
  ["Record documents, accidents and challans", ["compliance.manage"]],
  ["See every cost and report", ["report.view"]],
  ["Add and edit vehicles", ["vehicle.write"]],
  ["Manage people and settings", ["admin.users"]],
  ["Quote and invoice", ["quotation.submit"]],
];

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const m = await requireMembership(slug, { fullScope: true });
  const driver = getDriver();
  const [members, invites, roles, use, vendors, matrix, joinCode, requests, base, allowLearner, roleDepts, editable] = await Promise.all([
    listMembers(driver, m), listInvitations(driver, m), listRoles(driver, m), planUsage(driver, m), listVendors(driver, m).catch(() => []), getRoleMatrix(driver, m),
    getJoinCode(driver, m), listJoinRequests(driver, m), origin(), getLearnerAllowed(driver, m).catch(() => false), listRoleDepartments(driver, m).catch(() => ({} as Record<string, string>)), listEditableRoles(driver, m),
  ]);
  // Workshops never sign up and are not given logins (ADR-033), so the role is not offered. People already holding it keep it until removed.
  const roleOpts = roles.filter((r) => r.key !== "vendor").map((r) => [r.key, r.name] as [string, string]);
  const editing = typeof sp.edit === "string" ? members.find((p) => p.user_id === sp.edit && !p.is_me) : undefined;
  const status = (s: string): { tone: Tone; label: string } => (s === "active" ? { tone: "ok", label: "Active" } : s === "invited" ? { tone: "info", label: "Invited" } : { tone: "neutral", label: "Disabled" });
  const limitHit = use.users.limit !== null && use.users.used >= use.users.limit;

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      {typeof sp.note === "string" && sp.note && <p role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-900">{sp.note.slice(0, 300)}</p>}
      <PageHeader title="Users and roles" sub={`${plural(members.length + invites.length, "person", "people")} · ${plural(matrix.roles.length, "role")} · ${use.users.limit === null ? plural(use.users.used, "user") : `${use.users.used} of ${use.users.limit} users`}${limitHit ? " (limit reached)" : ""} · ${usage(use.vehicles)} vehicles`}
        actions={<a href="#invite" className={btnPrimary}>Invite a person</a>} />

      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          {requests.length > 0 && (
            <Panel title="Asked to join" sub="Nobody gets in until you approve. Approving sends them an invitation they accept after signing in." flush>
              <ul className="divide-y divide-zinc-100 text-sm">
                {requests.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-start justify-between gap-4 px-5 py-3">
                    <div className="min-w-0 space-y-0.5">
                      <p className="font-medium">{r.kind === "workshop" ? r.workshop_name : r.full_name} <Pill tone={r.kind === "workshop" ? "info" : "neutral"}>{r.kind === "workshop" ? "Workshop" : "Staff"}</Pill></p>
                      <p className="text-zinc-600">{r.kind === "workshop" ? `${r.full_name} · ` : ""}{r.email}{r.phone ? ` · ${r.phone}` : ""}</p>
                      {r.note && <p className="text-zinc-700">“{r.note}”</p>}
                      {r.kind === "staff" && (
                        <p className="text-xs text-zinc-700">
                          {r.licence ? <>Licence: {r.licence.type === "learner" ? "learner's permit" : "full"} ending <span className="font-mono">{r.licence.ends}</span>, expires {dmy(r.licence.expires_on)}</> : <span className="text-red-700">No driving licence on this request: decline it and ask them to ask again.</span>}
                          {" · "}{r.phone_confirmed ? "number confirmed on WhatsApp" : "number not confirmed on WhatsApp"}
                        </p>
                      )}
                      <p className="text-xs text-zinc-500">Asked on {dmy(r.created_at)}</p>
                    </div>
                    <JoinRequestActions slug={slug} id={r.id} kind={r.kind} roles={roleOpts} />
                  </li>))}
              </ul>
            </Panel>
          )}

          <Panel title="People" flush>
            <div className="overflow-x-auto" role="region" aria-label="People" tabIndex={0}><table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Name</th><th>Employee code</th><th>Sign-in</th><th>Role</th><th>Status</th><th>Since</th><th /></tr></thead>
              <tbody>
                {members.map((p) => (
                  <tr key={p.user_id} className={`border-t border-zinc-100 align-top ${p.status === "disabled" ? "text-zinc-500" : ""}`}>
                    <td className="px-5 py-3 font-medium">{p.full_name ?? p.vendor_name ?? "Unnamed"}{p.is_me && <span className="ml-2 text-xs font-normal text-zinc-500">You</span>}</td>
                    <td className="py-3 font-mono text-xs">{p.employee_no ?? "—"}</td>
                    <td className="py-3">{p.email ?? (p.username ? <span><span className="font-mono">{p.username}</span><span className="block text-xs text-zinc-500">Sign-in name</span></span> : p.vendor_name ? p.vendor_name : "—")}</td>
                    <td className="py-3">{p.role_name}{p.role_department ? <span className="block text-xs text-zinc-500">{p.role_department} vehicles only</span> : p.vehicle_scope === "own" && p.role !== "vendor" && <span className="block text-xs text-zinc-500">Own vehicle only</span>}</td>
                    <td className="py-3"><Pill tone={status(p.status).tone}>{status(p.status).label}</Pill></td>
                    <td className="py-3 whitespace-nowrap">{dmy(p.since)}</td>
                    <td className="py-3 pr-5 text-right">{!p.is_me && <a className="text-sky-800 underline" href={`/w/${slug}/users?edit=${p.user_id}#invite`}>Change</a>}{!p.is_me && p.username && p.status === "active" && <div className="mt-1 space-y-1 text-left"><ResetLink slug={slug} userId={p.user_id} /><ReplaceLogin slug={slug} userId={p.user_id} name={p.full_name ?? p.username} /></div>}</td>
                  </tr>))}
                {invites.map((i) => (
                  // keyed by who is invited, not by the invitation: "Send a new link" replaces the invitation (new id), and the row, with the link just made, must stay on screen
                  <tr key={`${i.employee_no ?? ""}|${i.email ?? ""}|${i.username ?? ""}|${i.vendor_name ?? ""}|${i.reset ? "reset" : i.full_name}`} className="border-t border-zinc-100 align-top">
                    <td className="px-5 py-3 font-medium">{i.full_name}</td>
                    <td className="py-3 font-mono text-xs">{i.employee_no ?? "—"}</td>
                    <td className="py-3">{i.email ?? (i.username ? <span className="font-mono">{i.username}</span> : "—")}{i.reset && <span className="block text-xs text-zinc-500">Password reset link</span>}{i.vendor_name && <span className="block text-xs text-zinc-500">{i.vendor_name}</span>}</td>
                    <td className="py-3">{i.role_name}</td>
                    <td className="py-3"><Pill tone={i.expired ? "bad" : "info"}>{i.expired ? "Link expired" : "Invited"}</Pill></td>
                    <td className="py-3 whitespace-nowrap">{dmy(i.created_at)}</td>
                    <td className="py-3 pr-5"><PendingActions slug={slug} id={i.id} /></td>
                  </tr>))}
              </tbody>
            </table></div>
          </Panel>

          <Panel title="Edit what each role can do" sub="Tick what a role may do and save. You can also make roles of your own, then give them to people from the list above.">
            <RolesPanel slug={slug} roles={editable} canAdd={editable.filter((r) => !r.builtin).length < MAX_CUSTOM_ROLES} />
          </Panel>

          <Panel title="What each role can do" sub="A summary of the roles as they are now" flush>
            <div className="overflow-x-auto" role="region" aria-label="What each role can do" tabIndex={0}><table className="w-full text-left text-sm">
              <thead className="text-[11px] uppercase tracking-wide text-zinc-500">
                <tr><th className="px-5 py-3" />{matrix.roles.map((r) => <th key={r.key} className="px-2">{r.name}<span className="block font-normal normal-case text-zinc-600">{plural(r.people, "person", "people")}</span></th>)}</tr>
              </thead>
              <tbody>{CAPABILITIES.map(([label, perms]) => (
                <tr key={label} className="border-t border-zinc-100">
                  <td className="px-5 py-2.5">{label}</td>
                  {matrix.roles.map((r) => <td key={r.key} className="px-2 py-2.5">{perms.some((p) => matrix.grants[r.key]?.includes(p)) ? <Pill tone="ok">Yes</Pill> : <span className="text-zinc-600">—</span>}</td>)}
                </tr>))}</tbody>
            </table></div>
          </Panel>
        </div>

        <div className="space-y-5" id="invite">
          {editing ? (
            <Panel title="Change access" sub={editing.full_name ?? editing.vendor_name ?? undefined} action={<a className="text-sm text-zinc-600 underline" href={`/w/${slug}/users`}>Close</a>}>
              <MemberControls key={editing.user_id} slug={slug} userId={editing.user_id} role={editing.role} scope={editing.vehicle_scope} status={editing.status} roles={roleOpts} roleDepts={roleDepts} isMe={editing.is_me} isVendor={editing.role === "vendor"} />
            </Panel>
          ) : (
            <Panel title="Invite a person" sub="Each invitation is for one employee code and one role, and the link is sent to the person's phone number only. They create their account with their email, or with a sign-in name you give them if they have no email. Workshops are not invited here: add them on the Vendors page, and they work from the links we email them, with no account and no licence. People can also ask to join with your company code, below.">
              <InviteForm stack slug={slug} allowLearner={allowLearner} roles={roleOpts} roleDepts={roleDepts} vendors={vendors.filter((v) => v.status === "active").map((v) => [v.id, v.name])} />
            </Panel>
          )}
          <Panel title="Company code" sub="So people can ask to join without waiting for an invitation">
            <JoinCodePanel slug={slug} code={joinCode} staffUrl={joinCode ? `${base}/join?code=${joinCode}` : ""} />
          </Panel>
          <Panel title="Built-in rules">
            <ul className="list-disc space-y-2 pl-5 text-sm">
              <li>Nobody approves their own job card.</li>
              <li>The person who approves a job cannot verify its invoice.</li>
              <li>Vendors see only their own work orders.</li>
              <li>Every change to a person’s access is written to the audit trail.</li>
            </ul>
          </Panel>
        </div>
      </div>
    </main>
  );
}
