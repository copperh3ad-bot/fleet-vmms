const STEPS = ["Assigned", "Quotation", "Approval", "Repair", "Invoice"] as const;
const AT: Record<string, number> = { vendor_assigned: 1, quotation_received: 2, quotation_approved: 3, in_progress: 3, completed: 4, invoiced: 5, invoice_verified: 5, closed: 5 };

/** The workshop's five steps, from the design. Everything before the current step is shown as done. */
export function VendorStepper({ jobStatus }: { jobStatus: string }) {
  const at = AT[jobStatus] ?? 1;
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Where this order is">
      {STEPS.map((s, i) => {
        const cls = i === at ? "border-brand bg-brand text-white" : i < at ? "border-green-200 bg-green-100 text-green-800" : "border-zinc-300 bg-white text-zinc-700";
        return <li key={s} aria-current={i === at ? "step" : undefined} className={`rounded-full border px-3 py-1 text-xs ${cls}`}>{s}</li>;
      })}
    </ol>
  );
}
