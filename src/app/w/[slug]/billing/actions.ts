"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { submitClaim } from "@/lib/billing/payments";
import { saveTaxProfile } from "@/lib/billing/tax-data";
import { issueCertificate } from "@/lib/billing/certificates";
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

/** The customer's own tax details. Allowed while locked, because paying is what unlocks, and the invoice needs them. */
export async function saveTaxProfileAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await saveTaxProfile(getDriver(), m, {
      ...Object.fromEntries(["country", "tax_rule_code", "legal_name", "ntn", "strn", "address"].map((k) => [k, str(form, k)])), withholding_agent: form.get("withholding_agent") === "on",
    });
    return "Saved. The amount to send, above, now includes your tax.";
  }, { allowLocked: true });
  if (state.ok) { refresh(); return state; }
  return { ...state, values: typed(form) };
}

/** The customer prepares the withholding certificate for one of its invoices. */
export async function issueCertificateAction(slug: string, invoiceId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    const r = await issueCertificate(getDriver(), { kind: "customer", m }, invoiceId, { deposit_reference: str(form, "deposit_reference"), deposit_date: str(form, "deposit_date"), note: str(form, "note") });
    return `Certificate ${r.number} prepared.`;
  }, { allowLocked: true });
  if (state.ok) { refresh(); return state; }
  return { ...state, values: typed(form) };
}
