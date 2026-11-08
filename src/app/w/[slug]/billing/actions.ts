"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { submitClaim } from "@/lib/billing/payments";
import { notifyClaimFiled } from "@/lib/billing/payment-mails";
import { saveTaxProfile } from "@/lib/billing/tax-data";
import { issueCertificate } from "@/lib/billing/certificates";
import { requireUser } from "@/lib/auth/session";
import { requestBill } from "@/lib/billing/request-details";
import { cancelBasicRequest, requestBasic, startProTrial } from "@/lib/billing/plan-switch";
import { runAction, str, typed, type FormState } from "../actions-util";

/** "I have paid": the transfer details and the receipt. Allowed while the workspace is locked, because that is when it is needed. */
export async function submitClaimAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  const file = form.get("proof");
  const user = await requireUser();
  const state = await runAction(slug, async (m) => {
    const proof = file instanceof File && file.size > 0 ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) } : undefined;
    const filed = await submitClaim(getDriver(), await supabaseBlobStore(), m, Object.fromEntries(["amount", "currency", "paid_on", "bank_reference", "months", "note", "plan"].map((k) => [k, str(form, k)])), proof, { submitterEmail: user.email ?? undefined });
    await notifyClaimFiled(getDriver(), filed.id);          // the Billing mailbox hears about it; a mail problem never undoes the claim
    return "Thank you. We will confirm it as soon as we see it in our bank, usually within one working day.";
  }, { allowLocked: true });
  if (state.ok) { refresh(); return state; }
  return { ...state, values: typed(form) };
}

/** The customer's own tax details. Allowed while locked, because paying is what unlocks, and the invoice needs them. */
export async function saveTaxProfileAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    // Pakistan only; the sales tax authority is the one in force and nobody withholds (ADR-053), so those are not asked.
    await saveTaxProfile(getDriver(), m, { ...Object.fromEntries(["legal_name", "ntn", "address"].map((k) => [k, str(form, k)])), withholding_agent: false });
    return "Saved. We can now issue your invoice.";
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

/** "Request bill": the bill, with the bank details, is emailed to the administrator; they never appear on a screen. Allowed while locked. */
export async function requestBillAction(slug: string, _prev: FormState, _form: FormData): Promise<FormState> {
  const user = await requireUser();
  return runAction(slug, (m) => requestBill(getDriver(), m, user.email ?? ""), { allowLocked: true });
}

/** A Basic company takes its free 3-day Pro trial, once (ADR-068). */
export async function startProTrialAction(slug: string, _prev: FormState, _form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await startProTrial(getDriver(), m); return "Your Pro trial has started. It runs for 3 days."; });
  if (state.ok) refresh();
  return state;
}

/** A Pro company asks to move to Basic when its paid period ends. */
export async function requestBasicAction(slug: string, _prev: FormState, _form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await requestBasic(getDriver(), m); return "Done. You stay on Pro until your paid period ends, then move to Basic."; });
  if (state.ok) refresh();
  return state;
}

/** Takes back the request to move to Basic. */
export async function cancelBasicAction(slug: string, _prev: FormState, _form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await cancelBasicRequest(getDriver(), m); return "Done. You stay on Pro."; });
  if (state.ok) refresh();
  return state;
}
