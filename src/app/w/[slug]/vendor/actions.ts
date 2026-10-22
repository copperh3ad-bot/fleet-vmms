"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { completeWork, startWork, submitInvoice, submitQuotation } from "@/lib/vendorflow/service";
import { linesFromForm, runAction, str, typed, type FormState } from "../actions-util";

const back = (state: FormState, form: FormData): FormState => (state.error || state.fields ? { ...state, values: typed(form) } : state);

export async function submitQuotationAction(slug: string, jobId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await submitQuotation(getDriver(), m, jobId, {
      details: str(form, "details"), days_needed: str(form, "days_needed"), valid_until: str(form, "valid_until"),
      warranty_months: str(form, "warranty_months"), lines: linesFromForm(form),
    });
    return "Quotation sent.";
  });
  if (state.ok) { refresh(); redirect(`/w/${slug}/vendor`); }
  return back(state, form);
}

export async function startWorkAction(slug: string, woId: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await startWork(getDriver(), m, woId); return "Work started."; });
  if (state.ok) refresh();
  return state;
}

export async function completeWorkAction(slug: string, woId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await completeWork(getDriver(), m, woId, str(form, "note")); return "Marked as done."; });
  if (state.ok) refresh();
  return back(state, form);
}

export async function submitInvoiceAction(slug: string, woId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await submitInvoice(getDriver(), m, woId, {
      invoice_no: str(form, "invoice_no"), invoice_date: str(form, "invoice_date"), tax_amount: str(form, "tax_amount"), lines: linesFromForm(form),
    });
    return "Invoice sent.";
  });
  if (state.ok) refresh();
  return back(state, form);
}
