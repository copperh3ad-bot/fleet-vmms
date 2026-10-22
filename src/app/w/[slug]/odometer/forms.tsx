"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Input, Notice, Submit, inputCls } from "@/components/form";
import { btn } from "@/components/ui";
import type { FormState } from "../actions-util";
import {
  approveNormalAction, closeCycleAction, createLinksAction, enterReadingAction, openCycleAction, remindOneAction, reviewAction, revokeAction,
  type LinksState, type SentLink,
} from "./actions";

export function OpenCycleForm({ slug, defaultPeriod }: { slug: string; defaultPeriod: string }) {
  const [state, action] = useActionState<FormState, FormData>(openCycleAction.bind(null, slug), {});
  const s = state.values ? state : { ...state, values: { period: defaultPeriod } };
  return (
    <form action={action} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_1fr_auto]" noValidate>
      <Input name="period" label="Month" type="month" state={s} required />
      <Input name="due_on" label="Due date" type="date" state={s} required />
      <Submit>Start month</Submit>
      <div className="sm:col-span-3"><Notice state={state} /></div>
    </form>
  );
}

function Btn({ children, tone = "plain", full }: { children: React.ReactNode; tone?: "primary" | "plain" | "danger"; full?: boolean }) {
  const { pending } = useFormStatus();
  const cls = tone === "primary" ? "bg-brand text-white" : tone === "danger" ? "border border-red-300 bg-white text-red-800" : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50";
  return <button type="submit" disabled={pending} className={`inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium disabled:opacity-60 ${cls} ${full ? "w-full" : ""}`}>{pending ? "Saving" : children}</button>;
}

/** The links just made, once, for copying or WhatsApp. */
function Links({ links }: { links: SentLink[] }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (url: string, id: string) => { try { await navigator.clipboard.writeText(url); setCopied(id); } catch { setCopied(null); } };
  if (links.length === 0) return null;
  return (
    <ul className="divide-y divide-amber-200 rounded-md border border-amber-200 bg-amber-50 text-sm text-zinc-900">
      {links.map((l) => (
        <li key={l.submission_id} className="flex flex-wrap items-center gap-2 p-3">
          <span className="min-w-0 flex-1"><span className="font-medium">{l.plate}</span> <span className="text-zinc-600">{l.holder_name ?? "No holder"}</span></span>
          <button type="button" onClick={() => copy(l.url, l.submission_id)} className={`${btn} h-9`}>{copied === l.submission_id ? "Copied" : "Copy link"}</button>
          {l.whatsapp && <a href={l.whatsapp} target="_blank" rel="noreferrer" className={`${btn} h-9`}>WhatsApp</a>}
        </li>
      ))}
    </ul>
  );
}

/** "Send reminder to N drivers": a fresh link for everyone still to send a reading. */
export function RemindAll({ slug, cycleId, waiting }: { slug: string; cycleId: string; waiting: number }) {
  const [state, action] = useActionState<LinksState, FormData>(createLinksAction.bind(null, slug, cycleId), {});
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <Btn>{`Send reminder to ${waiting} driver${waiting === 1 ? "" : "s"}`}</Btn>
        <p className="text-xs text-zinc-500">Each link works once and lasts 48 hours. New links cancel the old ones.</p>
      </form>
      <Notice state={state} />
      {state.links && <Links links={state.links} />}
    </div>
  );
}

export function RemindOne({ slug, cycleId, submissionId }: { slug: string; cycleId: string; submissionId: string }) {
  const [state, action] = useActionState<LinksState, FormData>(remindOneAction.bind(null, slug, cycleId, submissionId), {});
  return (
    <div className="space-y-2">
      <form action={action}><Btn>Remind</Btn></form>
      {state.error && <p role="alert" className="text-xs text-red-700">{state.error}</p>}
      {state.links && <Links links={state.links} />}
    </div>
  );
}

export function CloseButton({ slug, cycleId }: { slug: string; cycleId: string }) {
  const [state, action] = useActionState<FormState>(closeCycleAction.bind(null, slug, cycleId), {});
  return <form action={action} className="flex items-center gap-3"><Btn tone="primary">Close cycle</Btn><Notice state={state} /></form>;
}

export function RevokeButton({ slug, submissionId }: { slug: string; submissionId: string }) {
  const [state, action] = useActionState<FormState>(revokeAction.bind(null, slug, submissionId), {});
  return <form action={action} className="inline"><button className="text-xs text-zinc-500 underline" type="submit">Cancel link</button>{state.error && <span role="alert" className="ml-2 text-xs text-red-700">{state.error}</span>}</form>;
}

export function EnterReading({ slug, submissionId }: { slug: string; submissionId: string }) {
  const [state, action] = useActionState<FormState, FormData>(enterReadingAction.bind(null, slug, submissionId), {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="reading" aria-label="Reading in km" placeholder="Enter km" inputMode="decimal" defaultValue={state.values?.reading ?? ""} className={`${inputCls} w-28 font-mono`} />
      <Btn>Enter</Btn>
      <Notice state={state} />
    </form>
  );
}

/** A normal reading: one click. */
export function ApproveOne({ slug, submissionId }: { slug: string; submissionId: string }) {
  const [state, action] = useActionState<FormState, FormData>(reviewAction.bind(null, slug, submissionId, "approve"), {});
  return (
    <form action={action} className="flex items-center gap-2">
      <Btn tone="primary">Approve</Btn>
      {state.error && <span role="alert" className="text-xs text-red-700">{state.error}</span>}
    </form>
  );
}

/** A held reading: why it is held, then a note is required to accept it, or the driver is asked again. */
export function HeldReview({ slug, submissionId }: { slug: string; submissionId: string }) {
  const [a, approve] = useActionState<FormState, FormData>(reviewAction.bind(null, slug, submissionId, "approve"), {});
  const [r, reject] = useActionState<FormState, FormData>(reviewAction.bind(null, slug, submissionId, "reject"), {});
  const [note, setNote] = useState("");
  return (
    <div className="space-y-2">
      <label htmlFor={`note-${submissionId}`} className="block text-xs text-zinc-600">Note, required to accept</label>
      <div className="flex flex-wrap items-start gap-3">
        <input id={`note-${submissionId}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is this correct?" className={`${inputCls} min-w-[16rem] flex-1`} />
        <form action={approve}><input type="hidden" name="note" value={note} /><button type="submit" disabled={note.trim().length < 5} className="inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-white disabled:opacity-50">Accept with note</button></form>
        <form action={reject}><input type="hidden" name="note" value={note || "Please check the reading and send it again."} /><Btn>Send back to driver</Btn></form>
      </div>
      <Notice state={a} /><Notice state={r} />
    </div>
  );
}

export function ApproveAll({ slug, cycleId, count }: { slug: string; cycleId: string; count: number }) {
  const [state, action] = useActionState<FormState>(approveNormalAction.bind(null, slug, cycleId), {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Btn>{`Approve all ${count} normal reading${count === 1 ? "" : "s"}`}</Btn>
      <Notice state={state} />
    </form>
  );
}
