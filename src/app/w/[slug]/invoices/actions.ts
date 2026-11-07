"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { verifyInvoice, workshopContact } from "@/lib/vendorflow/service";
import { notifyWorkshop } from "@/lib/vendorflow/whatsapp-notify";
import { runAction, str, typed, type FormState } from "../actions-util";

export async function verifyInvoiceAction(slug: string, id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const decision = str(form, "decision");
  const state = await runAction(slug, async (m) => {
    const { jobId } = await verifyInvoice(getDriver(), m, id, decision, str(form, "note"));
    // the workshop is told on WhatsApp too (ADR-056); a message problem never undoes the decision
    await notifyWorkshop(decision === "return" ? "invoice_queried" : "invoice_accepted", await workshopContact(getDriver(), m, jobId).catch(() => null), m.tenantName || "A Fleet OTG customer", str(form, "note"));
    return decision === "return" ? "Invoice returned to the vendor." : "Invoice checked. The job card can now be closed.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}
