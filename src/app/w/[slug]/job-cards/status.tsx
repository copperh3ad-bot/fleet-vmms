export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", submitted: "Waiting for approval", approved: "Approved", rejected: "Rejected", returned_for_edit: "Sent back for edit",
  vendor_assigned: "Vendor assigned", quotation_received: "Quotation received", quotation_approved: "Quotation approved",
  in_progress: "In progress", completed: "Work done", invoiced: "Invoiced", invoice_verified: "Invoice verified", closed: "Closed", cancelled: "Cancelled",
};

const TONE: Record<string, string> = {
  draft: "bg-zinc-100 text-zinc-700", submitted: "bg-amber-100 text-amber-800", returned_for_edit: "bg-amber-100 text-amber-800",
  rejected: "bg-red-100 text-red-800", cancelled: "bg-zinc-100 text-zinc-600", closed: "bg-green-100 text-green-800",
};

export function StatusBadge({ status }: { status: string }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${TONE[status] ?? "bg-sky-100 text-sky-800"}`}>{STATUS_LABEL[status] ?? status}</span>;
}
