import { Pill, type Tone } from "@/components/ui";

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft", submitted: "Awaiting approval", approved: "Approved", rejected: "Rejected", returned_for_edit: "Sent back for edit",
  vendor_assigned: "Workshop assigned", quotation_received: "Quote received", quotation_approved: "Quote approved",
  in_progress: "In progress", completed: "Work done", invoiced: "Invoiced", invoice_verified: "Invoice checked", closed: "Closed", cancelled: "Cancelled",
};

const TONE: Record<string, Tone> = {
  draft: "neutral", submitted: "info", returned_for_edit: "warn", rejected: "bad", cancelled: "neutral", closed: "ok", invoice_verified: "ok",
};

export function StatusBadge({ status }: { status: string }) {
  return <Pill tone={TONE[status] ?? "info"}>{STATUS_LABEL[status] ?? status}</Pill>;
}

/** The ten stages in the design's strip. Quote received sits inside "Workshop assigned"; sent back counts as Draft. */
export const STAGES = ["Draft", "Submitted", "Approved", "Workshop assigned", "Quote approved", "In progress", "Completed", "Invoiced", "Invoice checked", "Closed"] as const;
const STAGE_OF: Record<string, number> = {
  draft: 0, returned_for_edit: 0, submitted: 1, approved: 2, vendor_assigned: 3, quotation_received: 3, quotation_approved: 4,
  in_progress: 5, completed: 6, invoiced: 7, invoice_verified: 8, closed: 9,
};

export function Stepper({ status }: { status: string }) {
  const at = STAGE_OF[status];
  if (at === undefined) return null;                       // rejected and cancelled end the card; the badge says so
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Where this job card is">
      {STAGES.map((s, i) => {
        const cls = i === at ? "border-zinc-900 bg-zinc-900 text-white" : i < at ? "border-green-200 bg-green-100 text-green-800" : "border-zinc-300 bg-white text-zinc-700";
        return <li key={s} aria-current={i === at ? "step" : undefined} className={`rounded-full border px-3 py-1 text-xs ${cls}`}>{s}</li>;
      })}
    </ol>
  );
}
