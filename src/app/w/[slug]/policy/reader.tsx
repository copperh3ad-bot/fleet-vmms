"use client";
import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Notice, Submit } from "@/components/form";
import { Pill } from "@/components/ui";
import type { FormState } from "../actions-util";
import type { Progress, Reading } from "@/lib/master/policy-reading";
import { applyFindingsAction, readNextPageAction, startReadingAction } from "./reading";

/** Reads the policy one page per call, shows progress, then lets a person choose what to apply. */
export function PolicyReader({ slug, policyId, reading }: { slug: string; policyId: string; reading: Reading | null }) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [live, setLive] = useState<Progress | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(first: boolean) {
    setError(null);
    let state = first ? await startReadingAction(slug, policyId) : await readNextPageAction(slug, policyId);
    for (let guard = 0; guard < 60; guard++) {
      if (state.error || !state.progress) { setError(state.error ?? "Reading stopped."); break; }
      setLive(state.progress);
      if (state.progress.status !== "reading") break;
      state = await readNextPageAction(slug, policyId);
    }
    setLive(null);
    router.refresh();
  }

  const shown = live ?? (reading?.status === "reading" ? reading : null);
  return (
    <div className="space-y-3">
      {shown ? (
        <p role="status" className="text-sm text-zinc-700">Reading page {Math.min(shown.pagesDone + 1, shown.pagesTotal)} of {shown.pagesTotal}. Scans take a few seconds a page.</p>
      ) : (
        <button type="button" disabled={busy} onClick={() => startBusy(() => run(true))} className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium disabled:opacity-60">
          {reading ? "Read it again" : "Read this policy"}
        </button>
      )}
      {!live && reading?.status === "reading" && (
        <button type="button" disabled={busy} onClick={() => startBusy(() => run(false))} className="ml-2 h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium disabled:opacity-60">Continue reading</button>
      )}
      {(error || (reading?.status === "failed" && reading.error)) && <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error ?? reading?.error}</p>}
      {reading?.status === "ready" && !shown && <Review slug={slug} policyId={policyId} reading={reading} />}
    </div>
  );
}

function Review({ slug, policyId, reading }: { slug: string; policyId: string; reading: Reading }) {
  const [state, action] = useActionState<FormState, FormData>(applyFindingsAction.bind(null, slug, policyId), {});
  const actionable = reading.findings.filter((f) => f.actionable);
  const notes = reading.findings.filter((f) => !f.actionable);

  if (reading.findings.length === 0)
    return <p className="text-sm text-zinc-600">{reading.textLength < 40 ? "No text could be read from this file. Try a clearer scan or photo." : "The text was read, but no rule this system applies was found in it. You can still set the rules by hand below."}</p>;

  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-zinc-600">Found in your policy{reading.confidence !== null && reading.confidence < 80 ? ` (the scan was hard to read, so check each number: ${reading.confidence}% sure)` : ""}. Tick what is right, then apply. Nothing changes until you do.</p>
      <ul className="space-y-3">
        {actionable.map((f) => (
          <li key={f.id} className="rounded-md border border-zinc-200 p-3 text-sm">
            <label className="flex items-start gap-3">
              <input type="checkbox" name="finding" value={f.id} defaultChecked={!f.applied} className="mt-1 h-4 w-4" />
              <span className="space-y-1">
                <span className="block font-medium">{f.label}: <span className="font-mono">{f.value}</span> {f.applied && <Pill tone="ok">Applied</Pill>}</span>
                <span className="block text-xs text-zinc-500">Now: {f.current ?? "not set"}</span>
                <span className="block text-xs italic text-zinc-600">“{f.quote}”</span>
              </span>
            </label>
          </li>))}
      </ul>
      {actionable.length > 0 && <div className="flex flex-wrap items-center gap-3"><Submit pendingText="Applying">Apply selected</Submit><Notice state={state} /></div>}
      {notes.length > 0 && (
        <div className="rounded-md bg-zinc-50 p-3 text-sm">
          <p className="mb-1 font-medium">Also in your policy, not applied by the system yet</p>
          <ul className="space-y-1 text-zinc-700">{notes.map((f) => <li key={f.id}>{f.label}: <span className="font-mono">{f.value}</span></li>)}</ul>
        </div>
      )}
    </form>
  );
}
