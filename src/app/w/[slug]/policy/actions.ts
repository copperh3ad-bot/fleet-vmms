"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { addPolicy, removePolicy } from "@/lib/master/policy";
import { UserError } from "@/lib/master/service";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { runAction, str, typed, type FormState } from "../actions-util";

export async function uploadPolicyAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  const file = form.get("file");
  const state = await runAction(slug, async (m) => {
    if (!(file instanceof File) || file.size === 0) throw new UserError("Choose the policy file first.");
    await addPolicy(getDriver(), await supabaseBlobStore(), m,
      { title: str(form, "title"), effective_from: str(form, "effective_from"), notes: str(form, "notes") },
      { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
    return "Policy uploaded. It is now the current policy.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

export async function removePolicyAction(slug: string, policyId: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await removePolicy(getDriver(), await supabaseBlobStore(), m, policyId); return "Policy removed."; });
  if (state.ok) refresh();
  return state;
}
