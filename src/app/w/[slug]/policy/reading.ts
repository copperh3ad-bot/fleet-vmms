"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { applyFindings, startReading, stepReading, type Progress } from "@/lib/master/policy-reading";
import { readPolicyWithAi } from "@/lib/ai/policy";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { runAction, type FormState } from "../actions-util";

export type StepState = FormState & { progress?: Progress };

/** Begins reading the policy's file. The screen then calls readNextPageAction until it says the reading is over. */
export async function startReadingAction(slug: string, policyId: string): Promise<StepState> {
  let progress: Progress | undefined;
  const state = await runAction(slug, async (m) => { progress = await startReading(getDriver(), await supabaseBlobStore(), m, policyId); return "Reading started."; });
  return { ...state, progress };
}

export async function readNextPageAction(slug: string, policyId: string): Promise<StepState> {
  let progress: Progress | undefined;
  const state = await runAction(slug, async (m) => { progress = await stepReading(getDriver(), await supabaseBlobStore(), m, policyId); });
  if (progress && progress.status !== "reading") refresh();
  return { ...state, progress };
}

export async function applyFindingsAction(slug: string, policyId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    const lines = await applyFindings(getDriver(), m, policyId, form.getAll("finding").map(String));
    return `Applied: ${lines.join("; ")}.`;
  });
  if (state.ok) refresh();
  return state;
}

/** Reads the policy with the AI in one go. The result is a draft in the same review as the plain reader's; nothing changes until a person applies it. */
export async function readWithAiAction(slug: string, policyId: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { const r = await readPolicyWithAi(getDriver(), await supabaseBlobStore(), m, policyId); return `The AI found ${r.findings} rule${r.findings === 1 ? "" : "s"}.`; });
  if (state.ok) refresh();
  return state;
}
