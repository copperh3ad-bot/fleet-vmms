"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Card, Field, Input, Notice, Select, inputCls } from "@/components/form";
import type { FormState } from "../actions-util";
import { saveJobCardAction } from "./actions";

type Line = { kind: string; description: string; qty: string; unit_cost: string };
const KINDS: [string, string][] = [["part", "Part"], ["labour", "Labour"], ["service", "Service"], ["other", "Other"]];
const blankLine = (): Line => ({ kind: "service", description: "", qty: "1", unit_cost: "" });

export type JobCardFormProps = {
  slug: string; id?: string;
  vehicles: { id: string; registration_no: string; label: string }[];
  reasons: { id: string; label: string; category: string }[];
  people?: { id: string; full_name: string }[];          // only for roles that may raise a card on someone's behalf
  initial?: Record<string, string>; initialLines?: Line[];
};

function Buttons({ editing }: { editing: boolean }) {
  const { pending } = useFormStatus();
  const base = "h-11 rounded-md px-5 font-medium disabled:opacity-60";
  return (
    <div className="flex flex-wrap gap-3">
      <button type="submit" name="intent" value="submit" disabled={pending} className={`${base} bg-sky-800 text-white`}>{pending ? "Saving" : "Submit for approval"}</button>
      <button type="submit" name="intent" value="draft" disabled={pending} className={`${base} border border-zinc-300 bg-white text-zinc-900`}>{editing ? "Save changes" : "Save as draft"}</button>
    </div>
  );
}

export function JobCardForm({ slug, id, vehicles, reasons, people, initial, initialLines }: JobCardFormProps) {
  const [state, action] = useActionState<FormState, FormData>(saveJobCardAction.bind(null, slug, id ?? ""), {});
  const [lines, setLines] = useState<Line[]>(initialLines?.length ? initialLines : [blankLine()]);
  const s: FormState = !state.values && initial ? { ...state, values: initial } : state;
  const total = lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);
  const set = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <form action={action} className="space-y-4" noValidate>
      <Card title="What needs doing">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Select name="vehicle_id" label="Vehicle" state={s} blank="Choose a vehicle" required options={vehicles.map((v) => [v.id, v.label])} />
          <Select name="reason_code_id" label="Reason" state={s} blank="Choose a reason" required options={reasons.map((r) => [r.id, r.label])} />
          <Select name="category" label="Type of work" state={{ ...s, values: { category: s.values?.category ?? "corrective" } }} blank="Choose"
            options={[["corrective", "Repair"], ["preventive", "Scheduled service"], ["accident", "Accident damage"], ["inspection", "Inspection"]]} />
          <Select name="priority" label="Priority" state={{ ...s, values: { priority: s.values?.priority ?? "normal" } }} blank="Choose"
            options={[["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]]} />
          <Input name="odometer_km" label="Odometer now (km)" state={s} inputMode="decimal" hint="Recorded as a reading for this vehicle" />
          <Input name="needed_by" label="Needed by" type="date" state={s} />
          {people && <Select name="requested_by" label="Raise on behalf of" state={s} blank="Myself" options={people.map((p) => [p.id, p.full_name])} />}
        </div>
        <div className="mt-3 space-y-3">
          <Field label="What went wrong, and why" name="cause_text" state={s} required hint="At least 10 characters. This is the root cause we track.">
            <textarea id="cause_text" name="cause_text" rows={3} defaultValue={s.values?.cause_text ?? ""} aria-invalid={!!s.fields?.cause_text} className={`${inputCls} h-auto py-2`} />
          </Field>
          <Field label="Extra details" name="description" state={s}>
            <textarea id="description" name="description" rows={2} defaultValue={s.values?.description ?? ""} className={`${inputCls} h-auto py-2`} />
          </Field>
        </div>
      </Card>

      <Card title="Expected work and cost">
        <div className="space-y-3">
          {lines.map((l, i) => {
            const err = (f: string) => s.fields?.[`lines.${i}.${f}`];
            return (
              <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-zinc-100 p-2 sm:grid-cols-[7rem_1fr_5rem_7rem_auto] sm:items-start sm:border-0 sm:p-0">
                <select name="line_kind" aria-label="Kind" className={inputCls} value={l.kind} onChange={(e) => set(i, { kind: e.target.value })}>
                  {KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
                </select>
                <div className="col-span-2 sm:col-span-1">
                  <input name="line_description" aria-label="Description" placeholder="Description" className={inputCls} value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
                  {err("description") && <p role="alert" className="mt-1 text-xs text-red-700">{err("description")}</p>}
                </div>
                <div>
                  <input name="line_qty" aria-label="Quantity" placeholder="Qty" inputMode="decimal" className={inputCls} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
                  {err("qty") && <p role="alert" className="mt-1 text-xs text-red-700">{err("qty")}</p>}
                </div>
                <div>
                  <input name="line_unit_cost" aria-label="Unit cost" placeholder="Unit cost" inputMode="decimal" className={inputCls} value={l.unit_cost} onChange={(e) => set(i, { unit_cost: e.target.value })} />
                  {err("unit_cost") && <p role="alert" className="mt-1 text-xs text-red-700">{err("unit_cost")}</p>}
                </div>
                <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blankLine()]))}
                  className="h-10 rounded-md px-3 text-sm text-zinc-600 underline" aria-label={`Remove line ${i + 1}`}>Remove</button>
              </div>
            );
          })}
          <div className="flex items-center justify-between">
            <button type="button" onClick={() => setLines((ls) => [...ls, blankLine()])} className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm">Add a line</button>
            <p className="text-sm text-zinc-600">Estimate <span className="font-medium tabular-nums text-zinc-900">{total.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span></p>
          </div>
        </div>
      </Card>

      <Notice state={state} />
      <Buttons editing={!!id} />
    </form>
  );
}
