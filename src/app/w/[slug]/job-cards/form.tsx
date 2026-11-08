"use client";
import { dm } from "@/lib/format/date";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { keepForm } from "@/components/keep-form";
import { Notice, inputCls } from "@/components/form";
import { FileInput } from "@/components/file-input";
import { Panel, Pill, Plate, btn } from "@/components/ui";
import type { JobContext } from "@/lib/jobcards/service";
import type { FormState } from "../actions-util";
import { jobContextAction, saveJobCardAction } from "./actions";

type Line = { kind: string; description: string; qty: string; unit_cost: string; service: string };
const KINDS: [string, string][] = [["part", "Part"], ["labour", "Labour"], ["service", "Service"], ["other", "Other"]];
const blankLine = (): Line => ({ kind: "service", description: "", qty: "1", unit_cost: "", service: "" });
const TYPES: [string, string][] = [["corrective", "Repair"], ["preventive", "Preventive service"], ["accident", "Accident"], ["inspection", "Inspection"]];
const PRIORITIES: [string, string][] = [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent, vehicle unsafe"]];
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export type JobCardFormProps = {
  slug: string; id?: string; currency?: string;
  vehicles: { id: string; registration_no: string; label: string }[];
  reasons: { id: string; label: string; category: string }[];
  serviceTags: { key: string; label: string }[];
  people?: { id: string; full_name: string }[];          // only for roles that may raise a card on someone's behalf
  initial?: Record<string, string>; initialLines?: { kind: string; description: string; qty: string; unit_cost: string; service_type_key?: string | null }[];
};

function Submits({ editing, slug, id, pending }: { editing: boolean; slug: string; id?: string; pending: boolean }) {
  return (
    <div className="flex flex-wrap gap-3">
      <a href={id ? `/w/${slug}/job-cards/${id}` : `/w/${slug}/job-cards`} className={`${btn} h-11`}>Cancel</a>
      <button type="submit" name="intent" value="draft" disabled={pending} className={`${btn} h-11 disabled:opacity-60`}>{editing ? "Save changes" : "Save draft"}</button>
      <button type="submit" name="intent" value="submit" disabled={pending} className="inline-flex h-11 items-center rounded-md bg-brand px-5 text-sm font-medium text-white disabled:opacity-60">{pending ? "Saving" : "Submit for approval"}</button>
    </div>
  );
}

function Radios({ name, value, onChange, options }: { name: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map(([v, l]) => (
        <label key={v} className={`inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border px-4 text-sm ${value === v ? "border-brand bg-sky-100 font-medium" : "border-zinc-300 bg-white"}`}>
          <input type="radio" name={name} value={v} checked={value === v} onChange={() => onChange(v)} className="accent-[#c2410c]" />{l}
        </label>
      ))}
    </div>
  );
}

const label = "mb-1 block text-xs font-medium text-zinc-600";
const req = <span className="text-red-700"> *</span>;

export function JobCardForm({ slug, id, currency = "PKR", vehicles, reasons, serviceTags, people, initial, initialLines }: JobCardFormProps) {
  const [state, action, pending] = useActionState<FormState, FormData>(saveJobCardAction.bind(null, slug, id ?? ""), {});
  const v0 = state.values ?? initial ?? {};
  const [vehicleId, setVehicleId] = useState(v0.vehicle_id ?? "");
  const [category, setCategory] = useState(v0.category ?? "corrective");
  const [priority, setPriority] = useState(v0.priority ?? "normal");
  const [reasonId, setReasonId] = useState(v0.reason_code_id ?? "");
  const [odometer, setOdometer] = useState(v0.odometer_km ?? "");
  const [cause, setCause] = useState(v0.cause_text ?? "");
  const [lines, setLines] = useState<Line[]>(initialLines?.length
    ? initialLines.map((l) => ({ kind: l.kind, description: l.description, qty: l.qty, unit_cost: l.unit_cost, service: l.service_type_key ?? "" })) : [blankLine()]);
  const [ctx, setCtx] = useState<JobContext | null>(null);
  const [, startLookup] = useTransition();
  const lookedUp = useRef("");

  // When the vehicle changes, fetch its context (odometer on file, budget, last jobs, warnings) from the server.
  useEffect(() => {
    if (!vehicleId || lookedUp.current === vehicleId) return;
    lookedUp.current = vehicleId;
    startLookup(async () => setCtx(await jobContextAction(slug, vehicleId)));
  }, [vehicleId, slug]);

  const shown = ctx && ctx.vehicle.id === vehicleId ? ctx : null;
  const estimate = lines.reduce((sum, l) => sum + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const err = (k: string) => state.fields?.[k];

  const onFile = shown?.vehicle.odometer_km ?? null;
  const odoNum = Number(odometer);
  const odoOk = odometer.trim() !== "" && Number.isFinite(odoNum) && (onFile === null || odoNum >= onFile);
  const repeat = shown && reasonId && category !== "preventive" ? shown.recent.find((r) => r.reason_code_id === reasonId) : undefined;
  const dueOil = shown?.due.find((d) => d.service_type_key === "oil_change") ?? shown?.due[0];
  const hasDueLine = dueOil ? lines.some((l) => l.service === dueOil.service_type_key) : false;
  const checks = [
    ["Vehicle and odometer", !!vehicleId && odoOk],
    ["Reason", !!reasonId],
    ["What you saw", cause.trim().length >= 10],
    ["At least one work line", lines.some((l) => l.description.trim() !== "")],
  ] as const;
  const left = checks.filter(([, ok]) => !ok).length;
  const budgetAfter = shown?.budget ? Math.round(((shown.budget.spent + estimate) / shown.budget.budget) * 100) : null;

  return (
    <form onSubmit={keepForm(action)} noValidate>          {/* sent by hand so an error message does not reset the drop-downs to their first option */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Panel title="Vehicle">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="vehicle_id" className={label}>Vehicle{req}</label>
                <select id="vehicle_id" name="vehicle_id" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={inputCls} aria-invalid={!!err("vehicle_id")}>
                  <option value="">Choose a vehicle</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                </select>
                {err("vehicle_id") && <p role="alert" className="mt-1 text-xs text-red-700">{err("vehicle_id")}</p>}
                <p className="mt-1 text-xs text-zinc-500">{shown?.vehicle.holder ? `Driver: ${shown.vehicle.holder}${shown.vehicle.department ? `, ${shown.vehicle.department}` : ""}. Filled in from the vehicle.` : "The driver is filled in from the vehicle."}</p>
              </div>
              <div>
                <label htmlFor="odometer_km" className={label}>Odometer reading now (km){req}</label>
                <input id="odometer_km" name="odometer_km" inputMode="decimal" value={odometer} onChange={(e) => setOdometer(e.target.value)} className={`${inputCls} font-mono`} aria-invalid={!!err("odometer_km") || (odometer !== "" && !odoOk)} />
                {err("odometer_km") ? <p role="alert" className="mt-1 text-xs text-red-700">{err("odometer_km")}</p>
                  : <p className={`mt-1 text-xs ${odometer !== "" && !odoOk ? "text-red-700" : "text-zinc-500"}`}>{onFile !== null ? `On file: ${money(onFile)} km${shown?.vehicle.odometer_updated_at ? ` on ${dm(shown.vehicle.odometer_updated_at)}` : ""}. Must be at least that.` : "Read the odometer on the vehicle's dashboard and type the number you see."}</p>}
              </div>
              {shown?.vehicle.tracks_hours && (
                <div>
                  <label htmlFor="engine_hours" className={label}>Hour meter now (hours)</label>
                  <input id="engine_hours" name="engine_hours" inputMode="decimal" defaultValue={v0.engine_hours ?? ""} className={`${inputCls} font-mono`} aria-invalid={!!err("engine_hours")} />
                  {err("engine_hours") ? <p role="alert" className="mt-1 text-xs text-red-700">{err("engine_hours")}</p>
                    : <p className="mt-1 text-xs text-zinc-500">{shown.vehicle.engine_hours !== null ? `On file: ${shown.vehicle.engine_hours.toLocaleString("en-US", { maximumFractionDigits: 1 })} hours. Must be at least that.` : "Read the hour meter. Optional, but it keeps hour-based services accurate."}</p>}
                </div>
              )}
              {people && (
                <div>
                  <label htmlFor="requested_by" className={label}>Raise on behalf of</label>
                  <select key={v0.requested_by ?? ""} id="requested_by" name="requested_by" defaultValue={v0.requested_by ?? ""} className={inputCls}><option value="">Myself</option>{people.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}</select>
                </div>
              )}
              <div>
                <label htmlFor="needed_by" className={label}>Needed by (optional)</label>
                <input id="needed_by" name="needed_by" type="date" defaultValue={v0.needed_by ?? ""} className={inputCls} />
              </div>
            </div>
            {dueOil && !hasDueLine && (
              <div className="mt-4 rounded-md bg-sky-100 p-3 text-sm text-sky-800">
                <p>{dueOil.label} is {dueOil.status === "overdue" ? `overdue${dueOil.days !== null ? ` by ${-dueOil.days} days` : ""}` : `due${dueOil.due_on ? ` ${dm(dueOil.due_on)}` : ""}${dueOil.days !== null ? `, in ${dueOil.days} days` : ""}`}. Add it to this job so the vehicle is only in the workshop once.</p>
                <button type="button" className={`${btn} mt-2 h-9 bg-white`} onClick={() => setLines((ls) => [...(ls.length === 1 && !ls[0].description ? [] : ls), { kind: "service", description: dueOil.label, qty: "1", unit_cost: "", service: dueOil.service_type_key }])}>Add {dueOil.label.toLowerCase()} line</button>
              </div>
            )}
          </Panel>

          <Panel title="What happened">
            <div className="space-y-5">
              <div><p className={label}>Type of job{req}</p><Radios name="category" value={category} onChange={setCategory} options={TYPES} /></div>
              <div>
                <label htmlFor="reason_code_id" className={label}>Main reason{req}</label>
                <select id="reason_code_id" name="reason_code_id" value={reasonId} onChange={(e) => setReasonId(e.target.value)} className={inputCls} aria-invalid={!!err("reason_code_id")}>
                  <option value="">Choose a reason</option>{reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
                {err("reason_code_id") && <p role="alert" className="mt-1 text-xs text-red-700">{err("reason_code_id")}</p>}
              </div>
              {repeat && (
                <p role="status" className="rounded-md bg-amber-100 p-3 text-sm text-amber-800"><strong>Repeat repair.</strong> {repeat.reason} was also raised on {dm(repeat.created_at)} ({repeat.job_no}, {repeat.days_ago} days ago). The manager will see this card marked as a repeat.</p>
              )}
              <div>
                <label htmlFor="cause_text" className={label}>What did you see, and when did it start?{req}</label>
                <textarea id="cause_text" name="cause_text" rows={4} value={cause} onChange={(e) => setCause(e.target.value)} aria-invalid={!!err("cause_text")} className={`${inputCls} h-auto py-2`} />
                {err("cause_text") && <p role="alert" className="mt-1 text-xs text-red-700">{err("cause_text")}</p>}
                <p className="mt-1 text-xs text-zinc-500"><span className="font-mono">{cause.trim().length}</span> characters. At least 10. Managers and reports read this, so be specific.</p>
              </div>
              <div>
                <label htmlFor="description" className={label}>Extra details (optional)</label>
                <textarea id="description" name="description" rows={2} defaultValue={v0.description ?? ""} className={`${inputCls} h-auto py-2`} />
              </div>
              <div><p className={label}>Priority</p><Radios name="priority" value={priority} onChange={setPriority} options={PRIORITIES} /></div>
            </div>
          </Panel>

          <Panel title="Work needed" sub="Estimates only. The workshop's quote replaces them." flush>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Type</th><th>Description</th><th>Service tag</th><th>Qty</th><th>Unit cost ({currency}, if known)</th><th className="px-5 text-right">Total</th></tr></thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={i} className="border-t border-zinc-100 align-top">
                      <td className="px-5 py-3"><select name="line_kind" aria-label="Type" className={`${inputCls} w-28`} value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value })}>{KINDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></td>
                      <td className="py-3 pr-2"><input name="line_description" aria-label="Description" className={inputCls} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                        {err(`lines.${i}.description`) && <p role="alert" className="mt-1 text-xs text-red-700">{err(`lines.${i}.description`)}</p>}</td>
                      <td className="py-3 pr-2"><select name="line_service" aria-label="Service tag" className={`${inputCls} w-36`} value={l.service} onChange={(e) => setLine(i, { service: e.target.value })}><option value="">None</option>{serviceTags.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select></td>
                      <td className="py-3 pr-2"><input name="line_qty" aria-label="Quantity" inputMode="decimal" className={`${inputCls} w-16 font-mono`} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                        {err(`lines.${i}.qty`) && <p role="alert" className="mt-1 text-xs text-red-700">{err(`lines.${i}.qty`)}</p>}</td>
                      <td className="py-3 pr-2"><input name="line_unit_cost" aria-label="Unit cost" inputMode="decimal" className={`${inputCls} w-28 font-mono`} value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} />
                        {err(`lines.${i}.unit_cost`) && <p role="alert" className="mt-1 text-xs text-red-700">{err(`lines.${i}.unit_cost`)}</p>}</td>
                      <td className="px-5 py-3 text-right"><span className="inline-flex h-10 items-center font-mono">{money((Number(l.qty) || 0) * (Number(l.unit_cost) || 0))}</span>
                        <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blankLine()]))} className="ml-2 text-xs text-zinc-500 underline" aria-label={`Remove line ${i + 1}`}>Remove</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-100 px-5 py-4">
              <button type="button" onClick={() => setLines((ls) => [...ls, blankLine()])} className={btn}>Add line</button>
              <p className="text-sm text-zinc-600">{estimate > 0 ? <>Estimated total <span className="ml-2 font-mono text-[22px] font-semibold text-zinc-900">{currency} {money(estimate)}</span></> : "No costs entered. That is fine: the workshop's quotation and invoice will give the real cost."}</p>
            </div>
          </Panel>

          <Panel title="Photos" sub="Up to 10. A photo of the odometer proves the reading.">
            {id ? <p className="text-sm text-zinc-600">Add or remove photos on the job card page.</p> : <FileInput label="Photos or PDF files for this job card" className="block w-full rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm" />}
          </Panel>

          <Notice state={state} />
          <p className="text-sm text-zinc-500">Goes to a Fleet Manager for approval. You can&apos;t approve your own job card.</p>
          <Submits editing={!!id} slug={slug} id={id} pending={pending} />
        </div>

        <aside className="space-y-5">
          <Panel title="Ready to submit?" action={<Pill tone={left === 0 ? "ok" : "warn"}>{left === 0 ? "All set" : `${left} to do`}</Pill>} flush>
            <ul className="divide-y divide-zinc-100 text-sm">
              {checks.map(([name, ok]) => <li key={name} className="flex items-center justify-between px-5 py-3"><span>{name}</span><Pill tone={ok ? "ok" : "neutral"}>{ok ? "Done" : "To do"}</Pill></li>)}
              <li className="flex items-center justify-between px-5 py-3"><span>Photos</span><Pill tone="neutral">Optional</Pill></li>
            </ul>
          </Panel>

          {shown && (
            <>
              <Panel title="This vehicle" action={<Plate>{shown.vehicle.registration_no}</Plate>}>
                {shown.budget ? (
                  <dl className="space-y-2 text-sm">
                    <div className="flex items-center justify-between"><dt className="text-zinc-500">Budget used</dt><dd><Pill tone={shown.budget.pct >= 100 ? "bad" : shown.budget.pct >= 80 ? "warn" : "ok"}>{Math.round(shown.budget.pct)}%</Pill></dd></div>
                    <div className="flex items-center justify-between"><dt className="text-zinc-500">This job adds</dt><dd className="font-mono">{money(estimate)}</dd></div>
                    {budgetAfter !== null && estimate > 0 && <div className="flex items-center justify-between"><dt className="text-zinc-500">After this job</dt><dd className="font-mono">{budgetAfter}%</dd></div>}
                    {shown.budget.pct >= 100 && <p className="pt-1 text-xs text-zinc-500">The vehicle is already over budget. The manager will see that when deciding.</p>}
                  </dl>
                ) : <p className="text-sm text-zinc-500">No budget is set for this vehicle.</p>}
              </Panel>
              <Panel title="Last jobs" flush>
                {shown.lastJobs.length === 0 ? <p className="p-5 text-sm text-zinc-500">No earlier jobs.</p> : (
                  <ul className="divide-y divide-zinc-100 text-sm">{shown.lastJobs.map((j) => (
                    <li key={j.job_no} className="flex items-baseline justify-between gap-3 px-5 py-3"><span>{dm(j.created_at)}<span className="block text-xs text-zinc-500">{j.reason}</span></span><span className="font-mono">{money(j.cost)}</span></li>))}</ul>
                )}
              </Panel>
            </>
          )}

          <Panel title="What happens next">
            <ol className="space-y-2.5 text-sm text-zinc-700">
              <li>A Fleet Manager reviews it and may change the reason.</li>
              <li>A workshop is assigned and sends a quote.</li>
              <li>The manager approves the quote. Work starts.</li>
              <li>The workshop sends the invoice. Finance checks it.</li>
            </ol>
          </Panel>
        </aside>
      </div>
    </form>
  );
}
