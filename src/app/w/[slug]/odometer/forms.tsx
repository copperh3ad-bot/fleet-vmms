"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Input, Notice, Submit, inputCls } from "@/components/form";
import type { FormState } from "../actions-util";
import { closeCycleAction, createLinksAction, enterReadingAction, openCycleAction, reviewAction, revokeAction, type LinksState } from "./actions";

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

function Plain({ children, danger }: { children: React.ReactNode; danger?: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className={`h-10 rounded-md px-4 text-sm font-medium disabled:opacity-60 ${danger ? "border border-red-300 bg-white text-red-800" : "bg-sky-800 text-white"}`}>{pending ? "Saving" : children}</button>;
}

export function LinksPanel({ slug, cycleId, waiting }: { slug: string; cycleId: string; waiting: number }) {
  const [state, action] = useActionState<LinksState, FormData>(createLinksAction.bind(null, slug, cycleId), {});
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (url: string, id: string) => { try { await navigator.clipboard.writeText(url); setCopied(id); } catch { setCopied(null); } };
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap items-center gap-3">
        <Plain>{`Make links for ${waiting} vehicle${waiting === 1 ? "" : "s"}`}</Plain>
        <p className="text-xs text-zinc-600">Each link works once and lasts 48 hours. Making new links cancels the old ones.</p>
      </form>
      <Notice state={state} />
      {state.links && state.links.length > 0 && (
        <ul className="divide-y divide-zinc-100 rounded-md border border-amber-200 bg-amber-50 text-sm">
          {state.links.map((l) => (
            <li key={l.submission_id} className="flex flex-wrap items-center gap-2 p-3">
              <span className="min-w-0 flex-1"><span className="font-medium">{l.plate}</span> <span className="text-zinc-600">{l.holder_name ?? "No holder"}</span></span>
              <button type="button" onClick={() => copy(l.url, l.submission_id)} className="h-9 rounded-md border border-zinc-300 bg-white px-3">{copied === l.submission_id ? "Copied" : "Copy link"}</button>
              {l.whatsapp && <a href={l.whatsapp} target="_blank" rel="noreferrer" className="h-9 rounded-md border border-zinc-300 bg-white px-3 leading-9">WhatsApp</a>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function CloseButton({ slug, cycleId }: { slug: string; cycleId: string }) {
  const [state, action] = useActionState<FormState>(closeCycleAction.bind(null, slug, cycleId), {});
  return <form action={action} className="flex items-center gap-3"><Plain danger>Close this month</Plain><Notice state={state} /></form>;
}

export function RevokeButton({ slug, submissionId }: { slug: string; submissionId: string }) {
  const [state, action] = useActionState<FormState>(revokeAction.bind(null, slug, submissionId), {});
  return <form action={action} className="inline"><button className="text-xs text-zinc-600 underline" type="submit">Cancel link</button>{state.error && <span role="alert" className="ml-2 text-xs text-red-700">{state.error}</span>}</form>;
}

export function EnterReading({ slug, submissionId }: { slug: string; submissionId: string }) {
  const [state, action] = useActionState<FormState, FormData>(enterReadingAction.bind(null, slug, submissionId), {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input name="reading" aria-label="Reading in km" placeholder="km" inputMode="decimal" defaultValue={state.values?.reading ?? ""} className={`${inputCls} w-28`} />
      <Plain>Enter</Plain>
      <Notice state={state} />
    </form>
  );
}

export function Review({ slug, submissionId }: { slug: string; submissionId: string }) {
  const [a, approve] = useActionState<FormState, FormData>(reviewAction.bind(null, slug, submissionId, "approve"), {});
  const [r, reject] = useActionState<FormState, FormData>(reviewAction.bind(null, slug, submissionId, "reject"), {});
  return (
    <div className="space-y-2">
      <form action={approve} className="flex flex-wrap items-center gap-2">
        <input name="note" aria-label="Note" placeholder="Note (needed if flagged)" defaultValue={a.values?.note ?? ""} className={`${inputCls} w-56`} />
        <Plain>Approve</Plain><Notice state={a} />
      </form>
      <form action={reject} className="flex flex-wrap items-center gap-2">
        <input name="note" aria-label="Reason" placeholder="Why is it wrong?" defaultValue={r.values?.note ?? ""} className={`${inputCls} w-56`} />
        <Plain danger>Reject</Plain><Notice state={r} />
      </form>
    </div>
  );
}
