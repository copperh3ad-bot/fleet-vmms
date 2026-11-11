// Shared by the payments service (server) and the payments panel (browser): no server imports here.
export type InvoiceKind = "workshop" | "trip";
export type ApprovalReason = "amount" | "over_quote" | "both";
export const APPROVAL_TEXT: Record<ApprovalReason, string> = {
  amount: "The invoice total is above the payment limit.",
  over_quote: "The invoice is above the approved quote by more than the allowed percent.",
  both: "The invoice total is above the payment limit and above the approved quote by more than the allowed percent.",
};
export const PAY_METHODS = [["bank_transfer", "Bank transfer"], ["cheque", "Cheque"], ["cash", "Cash"], ["online", "Online payment"], ["other", "Other"]] as const;

export type PaymentRow = {
  id: string; payment_no: string; amount: string; paid_on: string; method: string; reference: string | null; note: string | null;
  paid_by_name: string | null; created_at: string; voided_at: string | null; voided_by_name: string | null; void_reason: string | null;
};
export type PaymentSummary = {
  kind: InvoiceKind; invoiceId: string;
  /** what is owed once the invoice is checked; null while it is not checked yet */
  due: number | null; paid: number; remaining: number | null;
  /** true when the person looking holds invoice.pay (the button); `blocked` says why the person may not record this one */
  canPay: boolean; blocked: string | null;
  /** payment approval (ADR-087): `needed` says why one is required (null: none), `approvedBy` is who gave it; `canApprove` is for the person looking */
  approval: { needed: ApprovalReason | null; approvedBy: string | null; approvedAt: string | null; note: string | null; canApprove: boolean };
  status: "not_checked" | "unpaid" | "part_paid" | "paid";
  payments: PaymentRow[];
};
