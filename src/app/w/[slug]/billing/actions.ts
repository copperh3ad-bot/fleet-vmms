"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { submitClaim } from "@/lib/billing/payments";
import { runAction, str, typed, type FormState } from "../actions-util";

/** "I have paid": the transfer details and the receipt. Allowed while the workspace is locked, because that is when it is needed. */
export async function submitClaimAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  const file = form.get("proof");
  const state = await runAction(slug, async (m) => {
    const proof = file instanceof File && file.size > 0 ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : undefined;
    await submitClaim(getDriver(), await supabaseBlobStore(), m, Object.fromEntries(["amount", "currency", "paid_on", "bank_reference", "months", "note"].map((k) => [k, str(form, k)])), proof);
    return "Thank you. We will confirm it as soon as we see it in our bank, usually within one working day.";
  }, { allowLocked: true });
  if (state.ok) { refresh(); return state; }
  return { ...state, values: typed(form) };
}
