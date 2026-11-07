"use client";
import { useActionState, useState, type FormEvent } from "react";
import { Input, Notice, Select } from "@/components/form";
import { suggestUsername } from "@/lib/auth/username";
import { normalizePhone, smsLink, whatsappLink } from "@/lib/phone";
import type { FormState } from "../actions-util";
import { changeMemberAction, inviteAction, replaceLoginAction, resendAction, resetLinkAction, revokeAction, type InviteResult, type InviteState } from "./actions";

/** The link is sent to the person's phone number and nowhere else (ADR-026): no copy button, no email, and the link is not shown on screen. */
export function LinkBox({ invite }: { invite: InviteResult }) {
  const phone = invite.phone ? normalizePhone(invite.phone) : null;
  const byName = !invite.email && !!invite.username;
  const text = invite.reset
    ? `Your Fleet OTG password reset. Open this link and choose a new password. You will also need your recovery code (works once, valid 2 days): ${invite.url}`
    : byName
      ? `You are invited to join our fleet system. Your sign-in name is ${invite.username}. Open this link to choose your password (works once, valid 7 days): ${invite.url}`
      : `You are invited to join our fleet system. Create your account here (works once, valid 7 days): ${invite.url}`;
  if (invite.whatsapp === "sent" && phone?.ok) return (
    <div role="status" className="space-y-2 rounded-md border border-green-200 bg-green-50 p-3 text-sm text-zinc-900">
      <p>The invitation was sent on WhatsApp to <span className="font-medium">{invite.full_name}</span> on <span className="rounded bg-white px-1.5 py-0.5 font-mono font-medium">{phone.display}</span>, from the Fleet OTG number. It works once and is valid for 7 days.</p>
      {byName && <p>Their sign-in name is <span className="rounded bg-white px-1.5 py-0.5 font-mono font-medium">{invite.username}</span>.</p>}
      {invite.emailed === true && <p className="rounded bg-white px-2 py-1 text-green-900">We also emailed it to <span className="font-medium">{invite.email}</span>.</p>}
      <p className="text-xs text-zinc-700">Nobody in your company is given the link, so nobody can sign up in their place. Check the number is right; if it is not, cancel the invitation and invite again.</p>
    </div>
  );
  if (invite.whatsapp === "failed") return (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">The invitation could not be sent on WhatsApp to {phone?.ok ? phone.display : "that number"}. Use <span className="font-medium">Send a new link</span> beside it in the list below to try again, or check the number is on WhatsApp.</p>
  );
  if (!phone || !phone.ok) return <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">This invitation has no phone number, so it cannot be sent. Cancel it and invite again with a phone number.</p>;
  const btn = "inline-flex h-9 items-center rounded-md border border-zinc-300 bg-white px-3 text-sm font-medium text-zinc-900 hover:bg-zinc-50";
  return (
    <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-zinc-900">
      <p>
        Send the {invite.reset ? "password reset" : "invitation"} link to <span className="font-medium">{invite.full_name}</span> on <span className="rounded bg-white px-1.5 py-0.5 font-mono font-medium">{phone.display}</span>.
        {byName && <> Their sign-in name is <span className="rounded bg-white px-1.5 py-0.5 font-mono font-medium">{invite.username}</span>.</>} The link is not shown here.
      </p>
      {invite.emailed === true && <p className="rounded bg-white px-2 py-1 text-green-900">We also emailed the link to <span className="font-medium">{invite.email}</span>.</p>}
      {invite.emailed === false && invite.email && <p role="alert" className="rounded bg-white px-2 py-1 text-red-800">The email to {invite.email} could not be sent. Use WhatsApp or a text message, or send a new link.</p>}
      <div className="flex flex-wrap gap-2">
        <a className={btn} href={whatsappLink(phone.digits, text)} target="_blank" rel="noreferrer">Send on WhatsApp</a>
        <a className={btn} href={smsLink(phone.e164, text)}>Send as a text message</a>
      </div>
      {invite.reset
        ? <p className="text-xs text-zinc-700">They also need the recovery code they chose when they first set up. You do not have it and cannot see it, so the link is no use without them.</p>
        : <p className="text-xs text-zinc-700">Check the number on your phone before you press send. {byName ? "They choose their own password and recovery code. " : ""}The link works once. Do not open it yourself: whoever opens it first owns the account.</p>}
    </div>
  );
}

export function InviteForm({ slug, roles, vendors, stack }: { stack?: boolean; slug: string; roles: [string, string][]; vendors: [string, string][] }) {
  const [state, setState] = useState<InviteState>({});
  const [pending, setPending] = useState(false);
  const [role, setRole] = useState("");
  const [code, setCode] = useState("");
  const [noEmail, setNoEmail] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const isVendor = role === "vendor";
  const suggested = suggestUsername(slug, code);
  // In the narrow side panel the form is one column, so nothing may ask to span two: that forces a hidden second column and squeezes the fields.
  const span = stack ? "" : "sm:col-span-2";
  // Sent by hand, not as a form action: React clears a form after an action, which would wipe the role, the employee code and the
  // sign-in choice from a form that only needed one field fixed. This keeps everything the administrator entered until it works.
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const form = e.currentTarget;
    setPending(true);
    try {
      const result = await inviteAction(slug, {}, new FormData(form));
      setState(result);
      if (result.ok) { form.reset(); setRole(""); setCode(""); setTyped(null); setNoEmail(false); }
    } finally { setPending(false); }
  }
  return (
    <div className="space-y-3">
      <form onSubmit={submit} className={`grid grid-cols-1 gap-3 ${stack ? "" : "sm:grid-cols-2"}`} noValidate>
        {!isVendor && <Input name="employee_no" label="Employee number" state={state} required value={code} onChange={(e) => setCode(e.target.value)} hint="Their code on the employee record. It is made now, with the invitation." />}
        <Input name="full_name" label="Full name" state={state} required />
        {!isVendor && <Input name="department" label="Department" state={state} required />}
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
        <fieldset className={span}>
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
        <Input name="phone" label="Phone number" state={state} inputMode="tel" required hint="The invitation link is sent to this number, and nowhere else. For example 0300 1234567." />
        <div className={`flex flex-wrap items-center gap-3 ${span}`}><button type="submit" disabled={pending} className="h-10 rounded-md bg-brand px-5 text-sm font-medium text-white disabled:opacity-60">{pending ? "Adding" : isVendor ? "Create invitation" : "Add and invite"}</button><Notice state={state} /></div>
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

/** For someone who has forgotten both their password and their recovery code. It removes their login so they can be invited again. */
export function ReplaceLogin({ slug, userId, name }: { slug: string; userId: string; name: string }) {
  const [error, setError] = useState("");
  // The person's row changes as soon as this works, which would take the message with it. So the page is reloaded with the message on top.
  async function run(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!window.confirm(`Replace ${name}'s login?\n\nTheir sign-in name stops working at once and their employee code is freed, so you can invite them again with a new login. Do this only if they have forgotten both their password and their recovery code. It is recorded in the audit trail with your name.`)) return;
    const r = await replaceLoginAction(slug, userId);
    if (r.ok) window.location.assign(`/w/${slug}/users?note=${encodeURIComponent(r.ok)}`);
    else setError(r.error ?? "That did not work. Try again.");
  }
  return (
    <div className="space-y-1">
      <form onSubmit={run}><button className="text-sm text-red-700 underline" type="submit">Replace login</button></form>
      {error && <p role="alert" className="text-xs text-red-700">{error}</p>}
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
