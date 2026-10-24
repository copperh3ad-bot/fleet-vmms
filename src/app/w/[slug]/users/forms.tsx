"use client";
import { useActionState, useState } from "react";
import { Input, Notice, Select, Submit } from "@/components/form";
import { suggestUsername } from "@/lib/auth/username";
import type { FormState } from "../actions-util";
import { changeMemberAction, inviteAction, resendAction, resetLinkAction, revokeAction, type InviteResult, type InviteState } from "./actions";

function LinkBox({ invite }: { invite: InviteResult }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(invite.url); setCopied(true); } catch { setCopied(false); } };
  const byName = !invite.email && !!invite.username;
  const text = encodeURIComponent(
    invite.reset
      ? `Your Fleet OTG password reset. Open this link to choose a new password (works once, valid 2 days): ${invite.url}`
      : byName
        ? `You are invited to join our fleet system. Your sign-in name is ${invite.username}. Open this link to choose your password (works once, valid 7 days): ${invite.url}`
        : `You are invited to join our fleet system. Create your account here (works once, valid 7 days): ${invite.url}`);
  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-zinc-900">
      {byName
        ? <p>Give this to <span className="font-medium">{invite.full_name}</span>. Their sign-in name is <span className="rounded bg-white px-1.5 py-0.5 font-mono font-medium">{invite.username}</span>{invite.reset ? "" : ", and they choose their own password"}. The link is shown only now.</p>
        : <p>Send this to <span className="font-medium">{invite.email}</span>. It is shown only now.</p>}
      <input readOnly value={invite.url} onFocus={(e) => e.currentTarget.select()} aria-label="Invitation link" className="h-10 w-full rounded-md border border-zinc-300 bg-white px-2 text-xs" />
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="h-9 rounded-md border border-zinc-300 bg-white px-3">{copied ? "Copied" : "Copy link"}</button>
        {!byName && invite.email && <a className="h-9 rounded-md border border-zinc-300 bg-white px-3 leading-9" href={`mailto:${invite.email}?subject=${encodeURIComponent("Your invitation")}&body=${text}`}>Email it</a>}
        <a className="h-9 rounded-md border border-zinc-300 bg-white px-3 leading-9" href={`https://wa.me/?text=${text}`} target="_blank" rel="noreferrer">WhatsApp</a>
      </div>
    </div>
  );
}

export function InviteForm({ slug, roles, vendors, stack }: { stack?: boolean; slug: string; roles: [string, string][]; vendors: [string, string][] }) {
  const [state, action] = useActionState<InviteState, FormData>(inviteAction.bind(null, slug), {});
  const [role, setRole] = useState("");
  const [code, setCode] = useState("");
  const [noEmail, setNoEmail] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const isVendor = role === "vendor";
  const suggested = suggestUsername(slug, code);
  return (
    <div className="space-y-3">
      <form action={action} className={`grid grid-cols-1 gap-3 ${stack ? "" : "sm:grid-cols-2"}`} noValidate>
        {!isVendor && <Input name="employee_no" label="Employee code" state={state} required value={code} onChange={(e) => setCode(e.target.value)} hint="The code on their employee record. Their login is linked to that employee." />}
        <Input name="full_name" label="Full name" state={state} required={isVendor} hint={isVendor ? undefined : "Leave empty to use the name already on the employee record."} />
        <div>
          <label htmlFor="role" className="mb-1 block text-xs font-medium text-zinc-600">Role <span className="text-red-700">*</span></label>
          <select id="role" name="role" value={role} onChange={(e) => setRole(e.target.value)} className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-zinc-900" aria-invalid={!!state.fields?.role}>
            <option value="">Choose a role</option>{roles.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
          </select>
          {state.fields?.role && <p role="alert" className="mt-1 text-xs text-red-700">{state.fields.role}</p>}
        </div>
        {isVendor
          ? <Select name="vendor_id" label="Workshop" state={state} blank="Choose the workshop" required options={vendors} />
          : role === "requester"
            ? <Select key="own" name="vehicle_scope" label="Vehicles they can raise job cards for" state={{ ...state, values: { vehicle_scope: "own" } }} options={[["own", "Only the vehicle they hold"]]} />
            : <Select key="any" name="vehicle_scope" label="Vehicles they can see" state={{ ...state, values: { vehicle_scope: state.values?.vehicle_scope ?? "all" } }} blank="All" options={[["all", "All vehicles"], ["own", "Only the vehicle they hold"]]} />}
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-xs font-medium text-zinc-600">How will they sign in?</legend>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="contact" checked={!noEmail} onChange={() => setNoEmail(false)} /> With their email</label>
            <label className="flex items-center gap-2"><input type="radio" name="contact" checked={noEmail} onChange={() => setNoEmail(true)} /> With a sign-in name (no email)</label>
          </div>
        </fieldset>
        {noEmail
          ? <Input name="username" label="Sign-in name" state={state} required value={typed ?? suggested} onChange={(e) => setTyped(e.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false}
              hint="They sign in with this and a password they choose. Letters, numbers, dots and dashes." />
          : <Input name="email" label="Email" type="email" state={state} required hint="They confirm this address to join." />}
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

/** For a person who signs in with a name: they have no email to send a reset to, so the administrator makes a one-time link. */
export function ResetLink({ slug, userId }: { slug: string; userId: string }) {
  const [state, run] = useActionState<InviteState>(resetLinkAction.bind(null, slug, userId), {});
  return (
    <div className="space-y-2">
      <form action={run}><button className="text-sm text-sky-800 underline" type="submit">Make a password reset link</button></form>
      {state.error && <p role="alert" className="text-xs text-red-700">{state.error}</p>}
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
