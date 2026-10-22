"use client";
import { useActionState, useState } from "react";
import { Input, Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../actions-util";
import { changeMemberAction, inviteAction, resendAction, revokeAction, type InviteResult, type InviteState } from "./actions";

function LinkBox({ invite }: { invite: InviteResult }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(invite.url); setCopied(true); } catch { setCopied(false); } };
  const text = encodeURIComponent(`You are invited to join our fleet system. Create your account here (works once, valid 7 days): ${invite.url}`);
  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-zinc-900">
      <p>Send this to <span className="font-medium">{invite.email}</span>. It is shown only now.</p>
      <input readOnly value={invite.url} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" className="h-10 w-full rounded-md border border-zinc-300 bg-white px-2 text-xs" />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="h-9 rounded-md border border-zinc-300 bg-white px-3">{copied ? "Copied" : "Copy link"}</button>
        <a className="h-9 rounded-md border border-zinc-300 bg-white px-3 leading-9" href={`mailto:${invite.email}?subject=${encodeURIComponent("Your invitation")}&body=${text}`}>Email it</a>
        <a className="h-9 rounded-md border border-zinc-300 bg-white px-3 leading-9" href={`https://wa.me/?text=${text}`} target="_blank" rel="noreferrer">WhatsApp</a>
      </div>
    </div>
  );
}

export function InviteForm({ slug, roles, vendors }: { slug: string; roles: [string, string][]; vendors: [string, string][] }) {
  const [state, action] = useActionState<InviteState, FormData>(inviteAction.bind(null, slug), {});
  const [role, setRole] = useState("");
  return (
    <div className="space-y-3">
      <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
        <Input name="full_name" label="Full name" state={state} required />
        <Input name="email" label="Email" type="email" state={state} required hint="They must use this email to join." />
        <div>
          <label htmlFor="role" className="mb-1 block text-xs font-medium text-zinc-600">Role <span className="text-red-700">*</span></label>
          <select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)} className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-zinc-900" aria-invalid={!!state.fields?.role}>
            <option value="">Choose a role</option>{roles.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
          {state.fields?.role && <p role="alert" className="mt-1 text-xs text-red-700">{state.fields.role}</p>}
        </div>
        {role === "vendor"
          ? <Select name="vendor_id" label="Workshop" state={state} blank="Choose the workshop" required options={vendors} />
          : <Select name="vehicle_scope" label="Vehicles they can see" state={{ ...state, values: { vehicle_scope: state.values?.vehicle_scope ?? "all" } }} blank="All" options={[["all", "All vehicles"], ["own", "Only the vehicle they hold"]]} />}
        <Input name="phone" label="Phone (optional)" state={state} inputMode="tel" />
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2"><Submit>Create invitation</Submit><Notice state={state} /></div>
      </form>
      {state.invite && <LinkBox invite={state.invite} />}
    </div>
  );
}

export function PendingActions({ slug, id }: { slug: string; id: string }) {
  const [state, resend] = useActionState<InviteState>(resendAction.bind(null, slug, id), {});
  const [cancel, doCancel] = useActionState<FormState>(revokeAction.bind(null, slug, id), {});
  return (
    <div className="space-y-2">
      <div className="flex gap-3 text-sm">
        <form action={resend}><button className="text-sky-800 underline" type="submit">Send a new link</button></form>
        <form action={doCancel}><button className="text-zinc-600 underline" type="submit">Cancel</button></form>
      </div>
      {(state.error || cancel.error) && <p role="alert" className="text-xs text-red-700">{state.error ?? cancel.error}</p>}
      {state.invite && <LinkBox invite={state.invite} />}
    </div>
  );
}

export function MemberControls({ slug, userId, role, scope, status, roles, isMe, isVendor }: {
  slug: string; userId: string; role: string; scope: string; status: string; roles: [string, string][]; isMe: boolean; isVendor: boolean;
}) {
  const [state, action] = useActionState<FormState, FormData>(changeMemberAction.bind(null, slug, userId), {});
  if (isMe) return <span className="text-xs text-zinc-500">You</span>;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <select name="role" defaultValue={role} aria-label="Role" disabled={isVendor} className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm">
        {roles.filter(([k]) => (isVendor ? k === "vendor" : k !== "vendor")).map(([k, n]) => <option key={k} value={k}>{n}</option>)}
      </select>
      {!isVendor && <select name="vehicle_scope" defaultValue={scope} aria-label="Vehicles they can see" className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm"><option value="all">All vehicles</option><option value="own">Own vehicle only</option></select>}
      <select name="status" defaultValue={status} aria-label="Access" className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm"><option value="active">Active</option><option value="disabled">Disabled</option></select>
      <button className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm" type="submit">Save</button>
      {state.error && <span role="alert" className="text-xs text-red-700">{state.error}</span>}
      {state.ok && <span role="status" className="text-xs text-green-800">{state.ok}</span>}
    </form>
  );
}
