// Telling a workshop on WhatsApp what happened to what it sent (ADR-056): its estimate was approved or declined, its invoice was accepted or queried. The same Fleet OTG number
// that asks the workshop for the document sends these, using approved Utility templates whose names are set in Netlify (one setting each; none set means nothing is sent).
// Best effort: a workshop that has no mobile number, a template that is not set up, or a send that fails never undoes the decision, and nothing here logs a number or a message.
import { sendTemplate, whatsappConfigured } from "@/lib/whatsapp";

export type WorkshopEvent = "estimate_approved" | "estimate_declined" | "invoice_accepted" | "invoice_queried";
export type WorkshopContact = { vendor_name: string; phone: string; job_no: string };

/** The Netlify setting that names the template for each event. */
export const TEMPLATE_ENV: Record<WorkshopEvent, string> = {
  estimate_approved: "WHATSAPP_ESTIMATE_APPROVED_TEMPLATE", estimate_declined: "WHATSAPP_ESTIMATE_DECLINED_TEMPLATE",
  invoice_accepted: "WHATSAPP_INVOICE_ACCEPTED_TEMPLATE", invoice_queried: "WHATSAPP_INVOICE_QUERIED_TEMPLATE",
};

/** A template variable is one line and short: no line breaks, no runs of spaces, 160 letters at most. */
const one = (s: string, fallback: string) => { const t = s.replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, 160); return t || fallback; };

/** The template variables for an event, in the order the approved text has them. */
export function workshopParams(event: WorkshopEvent, c: WorkshopContact, org: string, note?: string): string[] {
  const base = [one(c.vendor_name, "there"), one(org, "your customer"), c.job_no];
  if (event === "estimate_declined") return [...base, one(note ?? "", "please see the job card on Fleet OTG")];
  if (event === "invoice_queried") return [...base, one(note ?? "", "please check the figures")];
  return base;
}

export type Delivery = "sent" | "not_set_up" | "no_phone" | "failed";

export async function notifyWorkshop(event: WorkshopEvent, c: WorkshopContact | null, org: string, note?: string, send: typeof sendTemplate = sendTemplate): Promise<Delivery> {
  const name = process.env[TEMPLATE_ENV[event]];
  if (!name || !whatsappConfigured()) return "not_set_up";
  if (!c || !c.phone) return "no_phone";
  try { await send(c.phone, { name, params: workshopParams(event, c, org, note) }); return "sent"; }
  catch (e) { console.error(`workshop whatsapp (${event}) failed: ${e instanceof Error ? e.message.slice(0, 120) : "unknown"}`); return "failed"; }
}
