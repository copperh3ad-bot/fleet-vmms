"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { approvePayment, recordPayment, voidPayment } from "@/lib/payments/service";
import type { InvoiceKind } from "@/lib/payments/types";
import { runAction, str, typed, type FormState } from "../actions-util";

const kindOf = (k: string): InvoiceKind => (k === "trip" ? "trip" : "workshop");

/** Finance or the administrator records a payment (part or whole) against a checked invoice (ADR-086). can() is checked in the service. */
export async function recordPaymentAction(slug: string, kind: string, invoiceId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await recordPayment(getDriver(), m, kindOf(kind), invoiceId, {
      amount: str(form, "amount"), paid_on: str(form, "paid_on"), method: str(form, "method"), reference: str(form, "reference"), note: str(form, "note"),
    });
    return "Payment recorded.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

/** A payment entered by mistake is voided with a reason; the row stays on the record. */
export async function voidPaymentAction(slug: string, paymentId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await voidPayment(getDriver(), m, paymentId, str(form, "reason")); return "Payment voided."; });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

/** A Fleet Manager or Administrator approves a payment that is over the limit or over the approved quote (ADR-087). */
export async function approvePaymentAction(slug: string, kind: string, invoiceId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await approvePayment(getDriver(), m, kindOf(kind), invoiceId, str(form, "note")); return "Payment approved."; });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}
