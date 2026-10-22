"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { completeWork, startWork, submitInvoice, submitQuotation, vendorAttach } from "@/lib/vendorflow/service";
import { supabaseBlobStore } from "@/lib/supabase/blob-store";
import { linesFromForm, runAction, str, typed, type FormState } from "../actions-util";

const back = (state: FormState, form: FormData): FormState => (state.error || state.fields ? { ...state, values: typed(form) } : state);

/** Files chosen on the form go to the record that was just created. A file that cannot be attached does not undo the record. */
async function attachAll(m: Parameters<typeof vendorAttach>[2], kind: "quotation" | "invoice", id: string, form: FormData): Promise<string> {
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return "";
  const store = await supabaseBlobStore();
  let failed = 0;
  for (const f of files) {
    try { await vendorAttach(getDriver(), store, m, kind, id, { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }); } catch { failed++; }
  }
  return failed ? ` ${failed} of ${files.length} files could not be attached; add them again from the order page.` : "";
}

export async function submitQuotationAction(slug: string, jobId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    const id = await submitQuotation(getDriver(), m, jobId, {
      details: str(form, "details"), days_needed: str(form, "days_needed"), valid_until: str(form, "valid_until"),
      warranty_months: str(form, "warranty_months"), lines: linesFromForm(form),
    });
    return `Quotation sent.${await attachAll(m, "quotation", id, form)}`;
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
    const id = await submitInvoice(getDriver(), m, woId, {
      invoice_no: str(form, "invoice_no"), invoice_date: str(form, "invoice_date"), tax_amount: str(form, "tax_amount"), lines: linesFromForm(form),
    });
    return `Invoice sent.${await attachAll(m, "invoice", id, form)}`;
  });
  if (state.ok) refresh();
  return back(state, form);
}
