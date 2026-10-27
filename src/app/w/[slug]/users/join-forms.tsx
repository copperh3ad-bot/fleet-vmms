"use client";
import { useActionState, useState } from "react";
import { Notice } from "@/components/form";
import type { FormState } from "../actions-util";
import { approveJoinAction, declineJoinAction, joinCodeAction } from "./join-actions";

function CopyLine({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(value); setCopied(true); } catch { setCopied(false); } };
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-zinc-600">{label}</p>
      <div className="flex gap-2">
        <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label={label} className="h-9 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2 text-xs" />
        <button type="button" onClick={copy} className="h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm">{copied ? "Copied" : "Copy"}</button>
      </div>
    </div>
  );
}

/** The company's code and the two links to give out. Turning it off or making a new one stops the old code at once. */
export function JoinCodePanel({ slug, code, staffUrl }: { slug: string; code: string | null; staffUrl: string }) {
  const [state, run] = useActionState<FormState, "on" | "regenerate" | "off">((_p, a) => joinCodeAction(slug, a), {});
  const btn = "h-9 rounded-md border border-zinc-300 bg-white px-3 text-sm";
  return (
    <div className="space-y-3 text-sm">
      {code ? (
        <>
          <p>Give this code to your staff. They ask to join, and nobody gets in until you approve. Workshops never sign up: add them under Vendors, and send them a link or an email from the job card.</p>
          <p className="font-mono text-2xl tracking-widest" aria-label="Company code">{`${code.slice(0, 5)}-${code.slice(5)}`}</p>
          <CopyLine label="Link for staff" value={staffUrl} />
          <div className="flex flex-wrap gap-2">
            <form action={() => run("regenerate")}><button type="submit" className={btn}>Make a new code</button></form>
            <form action={() => run("off")}><button type="submit" className={btn}>Switch off</button></form>
          </div>
        </>
      ) : (
        <>
          <p>Joining with a code is off. Switch it on to let staff ask to join, instead of waiting for an invitation from you.</p>
          <form action={() => run("on")}><button type="submit" className={btn}>Switch on</button></form>
        </>
      )}
      <Notice state={state} />
    </div>
  );
}

export function JoinRequestActions({ slug, id, kind, roles }: { slug: string; id: string; kind: "staff" | "workshop"; roles: [string, string][] }) {
  const [state, approve] = useActionState<FormState, FormData>(approveJoinAction.bind(null, slug, id), {});
  const [declined, decline] = useActionState<FormState>(declineJoinAction.bind(null, slug, id), {});
  return (
    <div className="space-y-2">
      <form action={approve} className="flex flex-wrap items-center gap-2">
        {kind === "staff" ? (
          <>
            <label className="sr-only" htmlFor={`code-${id}`}>Employee code</label>
            <input id={`code-${id}`} name="employee_no" placeholder="Employee code" required className="h-9 w-32 rounded-md border border-zinc-300 bg-white px-2 text-sm" aria-describedby={`code-hint-${id}`} />
            <span id={`code-hint-${id}`} className="sr-only">The code on this person&apos;s employee record</span>
            <label className="sr-only" htmlFor={`role-${id}`}>Role</label>
            <select id={`role-${id}`} name="role" defaultValue="requester" className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm">
              {roles.filter(([k]) => k !== "vendor").map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
            <label className="sr-only" htmlFor={`scope-${id}`}>Vehicles</label>
            <select id={`scope-${id}`} name="vehicle_scope" defaultValue="own" className="h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm">
              <option value="own">Own vehicle only</option><option value="all">All vehicles</option>
            </select>
          </>
        ) : <span className="text-xs text-zinc-600">Joins as a workshop</span>}
        <button type="submit" className="h-9 rounded-md bg-brand px-4 text-sm font-medium text-white">Approve</button>
      </form>
      <form action={decline}><button type="submit" className="text-xs text-zinc-600 underline">Decline</button></form>
      {(state.error || declined.error) && <p role="alert" className="text-xs text-red-700">{state.error ?? declined.error}</p>}
    </div>
  );
}
