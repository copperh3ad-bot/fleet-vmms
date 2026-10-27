// Staff type in the figures from a workshop's emailed reply (ADR-033). Kept apart from service.ts because it needs both that file and link.ts.
import type { Driver } from "@/lib/db/types";
import { authorizedAny, type Membership } from "@/lib/auth/can";
import { UserError } from "@/lib/master/service";
import { createWorkshopLink, setWorkshopEmailStatus, type WorkshopLinkKind } from "./service";
import { submitViaInvoiceLink, submitViaQuoteLink } from "./link";

/**
 * It goes through the same one-time-link function the workshop's own form uses, so the job card moves the same way and every rule is the
 * same; the history names the person who typed it in, not the workshop. Any link the workshop still holds for this request stops working,
 * because the request has been answered.
 */
export async function enterForWorkshop(driver: Driver, m: Membership, jobId: string, kind: WorkshopLinkKind, input: unknown, emailId?: string): Promise<void> {
  const link = await createWorkshopLink(driver, m, jobId, kind);                    // checks the permission and the job card's state
  const who = await authorizedAny(driver, m, ["jobcard.assign_vendor", "quotation.approve", "invoice.verify"], async (q) =>
    (await q.query<{ full_name: string }>("select full_name from employees where user_id = $1 limit 1", [m.userId])).rows[0]?.full_name ?? "staff");
  const comment = `${kind === "quotation" ? "Estimate" : "Invoice"} typed in by ${who} from the workshop's email`;
  const r = kind === "quotation" ? await submitViaQuoteLink(driver, link.token, input, { comment }) : await submitViaInvoiceLink(driver, link.token, input, { comment });
  if (!r.ok) throw new UserError(r.reason === "bad_input" ? r.message : "This job card is no longer waiting for that. Reload the page.");
  if (emailId) await setWorkshopEmailStatus(driver, m, emailId, "entered");
}
