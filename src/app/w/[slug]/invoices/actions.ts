"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { verifyInvoice } from "@/lib/vendorflow/service";
import { runAction, str, typed, type FormState } from "../actions-util";

export async function verifyInvoiceAction(slug: string, id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const decision = str(form, "decision");
  const state = await runAction(slug, async (m) => {
    await verifyInvoice(getDriver(), m, id, decision, str(form, "note"));
    return decision === "return" ? "Invoice returned to the vendor." : "Invoice checked. The job card can now be closed.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}
