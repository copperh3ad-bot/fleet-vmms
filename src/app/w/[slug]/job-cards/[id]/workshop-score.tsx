"use client";
import { useActionState } from "react";
import { Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import type { Scorecard } from "@/lib/vendorflow/scorecard";
import { rateVendorAction } from "../actions";

const dash = (v: number | null, unit = "") => (v === null ? "no data" : `${v}${unit}`);

/** The workshop's last 12 months, beside its quotation (C2). Plain words, no colours that carry meaning alone. */
export function WorkshopScore({ s }: { s: Scorecard | null }) {
  if (!s) return null;
  return (
    <div className="mt-2 rounded-md bg-zinc-50 p-3 text-xs text-zinc-700">
      <p className="mb-1 font-medium text-zinc-900">Workshop record, last 12 months{s.flagged && <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-red-800">Flagged{s.flag_note ? `: ${s.flag_note}` : ""}</span>}</p>
      {s.jobs === 0 && s.ratings === 0 ? <p>No finished jobs with this workshop yet.</p> : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
          <div><dt className="inline text-zinc-500">Jobs done </dt><dd className="inline font-mono">{s.jobs}</dd></div>
          <div><dt className="inline text-zinc-500">Average days </dt><dd className="inline font-mono">{dash(s.avg_days)}</dd></div>
          <div><dt className="inline text-zinc-500">On time </dt><dd className="inline font-mono">{dash(s.on_time_pct, "%")}</dd></div>
          <div><dt className="inline text-zinc-500">Bill vs quote </dt><dd className="inline font-mono">{dash(s.bill_vs_quote_pct, "%")}</dd></div>
          <div><dt className="inline text-zinc-500">Repeat repairs </dt><dd className="inline font-mono">{s.rework}</dd></div>
          <div><dt className="inline text-zinc-500">Rating </dt><dd className="inline font-mono">{s.rating === null ? "none" : `${s.rating} / 5 (${s.ratings})`}</dd></div>
        </dl>
      )}
    </div>
  );
}

/** The Fleet Manager rates and flags the workshop (C4). */
export function RateWorkshop({ slug, vendorId, jobId }: { slug: string; vendorId: string; jobId: string }) {
  const [state, action] = useActionState<FormState, FormData>(rateVendorAction.bind(null, slug, vendorId, jobId), {});
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-sky-800">Rate or flag this workshop</summary>
      <form action={action} className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3" noValidate>
        <Select name="stars" label="Stars" state={state} blank="Choose" options={[["5", "5 - very good"], ["4", "4"], ["3", "3"], ["2", "2"], ["1", "1 - poor"]]} />
        <label className="block text-xs font-medium text-zinc-600">Note (needed to flag)
          <input name="note" defaultValue={state.values?.note ?? ""} className="mt-1 h-10 w-full rounded-md border border-zinc-300 px-3 text-sm" />
        </label>
        <label className="flex items-end gap-2 pb-2 text-xs"><input type="checkbox" name="flagged" /> Flag this workshop</label>
        <div className="flex items-center gap-3 sm:col-span-3"><Submit>Save rating</Submit><Notice state={state} /></div>
      </form>
    </details>
  );
}
