"use client";
import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { Notice, inputCls } from "@/components/form";
import { FileInput } from "@/components/file-input";
import { Plate, btn } from "@/components/ui";
import type { JobContext } from "@/lib/jobcards/service";
import type { FormState } from "../actions-util";
import { jobContextAction, saveJobCardAction } from "./actions";

// The phone version of "New job card": four short steps, one question at a time. It posts the same fields as the
// desktop form to the same action, so every rule (approver is not the requester, odometer not lower, attachment
// checks) is the one the server already applies. All steps stay in the page (hidden) so every value is submitted.

type Line = { kind: string; description: string; qty: string; unit_cost: string };
const WORK: [string, string][] = [["repair", "Repair"], ["service", "Service"], ["accident", "Accident damage"], ["tyres", "Tyres"]];
const CATEGORY: Record<string, string> = { repair: "corrective", service: "preventive", accident: "accident", tyres: "corrective" };
const PRIORITIES: [string, string][] = [["low", "Low"], ["normal", "Normal"], ["high", "High"], ["urgent", "Urgent"]];
const KINDS: [string, string][] = [["part", "Part"], ["labour", "Labour"], ["service", "Service"], ["other", "Other"]];
const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });
const dm = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const lbl = "mb-1.5 block text-sm font-medium text-zinc-900";
const big = `${inputCls} h-12 text-base`;

type Props = {
  slug: string;
  vehicles: { id: string; registration_no: string; label: string }[];
  reasons: { id: string; label: string; category: string }[];
  initial?: Record<string, string>;
};

function Chip({ on, children, onClick }: { on: boolean; children: React.ReactNode; onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-pressed={on} className={`h-12 rounded-full border px-5 text-base ${on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-400 bg-white text-zinc-900"}`}>{children}</button>;
}

function Send({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" name="intent" value="submit" disabled={pending || disabled} className="h-12 flex-1 rounded-lg bg-brand text-base font-semibold text-white disabled:opacity-50">{pending ? "Saving" : "Submit for approval"}</button>;
}
function Draft() {
  const { pending } = useFormStatus();
  return <button type="submit" name="intent" value="draft" disabled={pending} className={`${btn} h-12 px-6 text-base font-semibold disabled:opacity-60`}>Save</button>;
}

export function JobCardWizard({ slug, vehicles, reasons, initial }: Props) {
  const [state, action] = useActionState<FormState, FormData>(saveJobCardAction.bind(null, slug, ""), {});
  const v0 = state.values ?? initial ?? {};
  const [step, setStep] = useState(1);
  const [vehicleId, setVehicleId] = useState(v0.vehicle_id ?? "");
  const [odometer, setOdometer] = useState(v0.odometer_km ?? "");
  const [work, setWork] = useState("repair");
  const [reasonId, setReasonId] = useState(v0.reason_code_id ?? "");
  const [cause, setCause] = useState(v0.cause_text ?? "");
  const [priority, setPriority] = useState(v0.priority ?? "normal");
  const [lines, setLines] = useState<Line[]>([{ kind: "service", description: "", qty: "1", unit_cost: "" }]);
  const [ctx, setCtx] = useState<JobContext | null>(null);
  const [, startLookup] = useTransition();
  const lookedUp = useRef("");

  useEffect(() => {
    if (!vehicleId || lookedUp.current === vehicleId) return;
    lookedUp.current = vehicleId;
    startLookup(async () => setCtx(await jobContextAction(slug, vehicleId)));
  }, [vehicleId, slug]);

  const shown = ctx && ctx.vehicle.id === vehicleId ? ctx : null;
  const vehicle = vehicles.find((v) => v.id === vehicleId);
  const onFile = shown?.vehicle.odometer_km ?? null;
  const odoNum = Number(odometer);
  const odoOk = odometer.trim() !== "" && Number.isFinite(odoNum) && (onFile === null || odoNum >= onFile);
  const step1Ok = !!vehicleId && odoOk;
  const step2Ok = !!reasonId && cause.trim().length >= 10;
  const estimate = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const err = (k: string) => state.fields?.[k];
  const reasonLabel = reasons.find((r) => r.id === reasonId)?.label;

  function pickWork(key: string) {
    setWork(key);
    const want = key === "service" ? reasons.find((r) => r.category === "scheduled_service")
      : key === "accident" ? reasons.find((r) => r.category === "accident_damage")
      : key === "tyres" ? reasons.find((r) => /tyre/i.test(r.label)) : undefined;
    if (want) setReasonId(want.id);
  }
  const show = (n: number) => (step === n ? "space-y-5" : "hidden");

  return (
    <form action={action} noValidate className="overflow-hidden rounded-xl border border-zinc-200 bg-white">
      <div className="bg-side px-5 pb-4 pt-4 text-white">
        <div className="flex items-center justify-between text-sm">
          {step === 1 ? <a href={`/w/${slug}/job-cards`} className="text-zinc-300">‹ Cancel</a> : <button type="button" onClick={() => setStep(step - 1)} className="text-zinc-300">‹ Back</button>}
          <span className="text-zinc-300">Step {step} of 4</span>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2" aria-hidden>{[1, 2, 3, 4].map((n) => <span key={n} className={`h-1.5 rounded-full ${n <= step ? "bg-badge" : "bg-side-active"}`} />)}</div>
      </div>

      <div className="space-y-5 p-5">
        {/* 1 */}
        <section className={show(1)}>
          <h2 className="text-2xl font-semibold">Which vehicle?</h2>
          <div>
            <label htmlFor="m_vehicle_id" className={lbl}>Vehicle</label>
            <select id="m_vehicle_id" name="vehicle_id" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} className={big} aria-invalid={!!err("vehicle_id")}>
              <option value="">Choose a vehicle</option>{vehicles.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
            </select>
            {err("vehicle_id") && <p role="alert" className="mt-1 text-sm text-red-700">{err("vehicle_id")}</p>}
            {shown?.vehicle.holder && <p className="mt-1 text-sm text-zinc-500">Driver: {shown.vehicle.holder}</p>}
          </div>
          <div>
            <label htmlFor="m_odometer_km" className={lbl}>What does the dashboard show now? (km)</label>
            <input id="m_odometer_km" name="odometer_km" inputMode="decimal" value={odometer} onChange={(e) => setOdometer(e.target.value)} placeholder="e.g. 48,320" className={`${big} font-mono`} aria-invalid={!!err("odometer_km") || (odometer !== "" && !odoOk)} />
            <p className={`mt-1 text-sm ${(odometer !== "" && !odoOk) || err("odometer_km") ? "text-red-700" : "text-zinc-500"}`}>
              {err("odometer_km") ?? (onFile !== null ? `Last reading we have: ${money(onFile)} km${shown?.vehicle.odometer_updated_at ? ` on ${dm(shown.vehicle.odometer_updated_at)}` : ""}. Must be at least that.` : "Look at the dashboard and type the number you see.")}
            </p>
          </div>
        </section>

        {/* 2 */}
        <section className={show(2)}>
          <div><h2 className="text-2xl font-semibold">What&apos;s wrong?</h2>{vehicle && <p className="mt-1 flex items-center gap-2 text-sm text-zinc-600"><Plate>{vehicle.registration_no}</Plate>{vehicle.label.split(" · ")[1]}</p>}</div>
          <div><p className={lbl}>Type of work</p><div className="flex flex-wrap gap-2.5" role="group">{WORK.map(([k, l]) => <Chip key={k} on={work === k} onClick={() => pickWork(k)}>{l}</Chip>)}</div></div>
          <input type="hidden" name="category" value={CATEGORY[work]} />
          <div>
            <label htmlFor="m_reason" className={lbl}>Why did this happen?</label>
            <select id="m_reason" name="reason_code_id" value={reasonId} onChange={(e) => setReasonId(e.target.value)} className={big} aria-invalid={!!err("reason_code_id")}>
              <option value="">Choose a reason</option>{reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
            {err("reason_code_id") && <p role="alert" className="mt-1 text-sm text-red-700">{err("reason_code_id")}</p>}
          </div>
          <div>
            <label htmlFor="m_cause" className={lbl}>Describe the problem</label>
            <textarea id="m_cause" name="cause_text" rows={4} value={cause} onChange={(e) => setCause(e.target.value)} className={`${inputCls} h-auto py-3 text-base`} aria-invalid={!!err("cause_text")} />
            <p className="mt-1 flex justify-between text-sm text-zinc-500"><span>Say what you saw, heard or felt.</span><span className="font-mono">{cause.trim().length} · 10 minimum</span></p>
            {err("cause_text") && <p role="alert" className="mt-1 text-sm text-red-700">{err("cause_text")}</p>}
          </div>
          <div><p className={lbl}>Photos</p><FileInput id="m_files" className="block w-full rounded-lg border border-dashed border-zinc-400 bg-white p-4 text-base" /></div>
        </section>

        {/* 3 */}
        <section className={show(3)}>
          <h2 className="text-2xl font-semibold">How urgent, and what will it cost?</h2>
          <div><p className={lbl}>Priority</p><div className="flex flex-wrap gap-2.5" role="group">{PRIORITIES.map(([k, l]) => <Chip key={k} on={priority === k} onClick={() => setPriority(k)}>{l}</Chip>)}</div></div>
          <input type="hidden" name="priority" value={priority} />
          <div><label htmlFor="m_needed" className={lbl}>Needed by (optional)</label><input id="m_needed" name="needed_by" type="date" defaultValue={v0.needed_by ?? ""} className={big} /></div>
          <div>
            <p className={lbl}>Work needed (a rough estimate is fine)</p>
            <div className="space-y-3">
              {lines.map((l, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-zinc-200 p-3">
                  <input type="hidden" name="line_service" value="" />
                  <div className="grid grid-cols-[7rem_1fr] gap-2">
                    <select name="line_kind" aria-label="Type" className={big} value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value })}>{KINDS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
                    <input name="line_description" aria-label="Description" placeholder="What" className={big} value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} />
                  </div>
                  <div className="grid grid-cols-[5rem_1fr_auto] items-center gap-2">
                    <input name="line_qty" aria-label="Quantity" inputMode="decimal" className={`${big} font-mono`} value={l.qty} onChange={(e) => setLine(i, { qty: e.target.value })} />
                    <input name="line_unit_cost" aria-label="Unit cost" inputMode="decimal" placeholder="Cost each (PKR)" className={`${big} font-mono`} value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} />
                    <button type="button" className="text-sm text-zinc-500 underline" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [{ kind: "service", description: "", qty: "1", unit_cost: "" }]))}>Remove</button>
                  </div>
                  {err(`lines.${i}.description`) && <p role="alert" className="text-sm text-red-700">{err(`lines.${i}.description`)}</p>}
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <button type="button" onClick={() => setLines((ls) => [...ls, { kind: "service", description: "", qty: "1", unit_cost: "" }])} className={`${btn} h-11`}>Add line</button>
              <p className="text-sm text-zinc-600">Estimate <span className="ml-1 font-mono text-lg font-semibold text-zinc-900">PKR {money(estimate)}</span></p>
            </div>
          </div>
          <div><label htmlFor="m_desc" className={lbl}>Extra details (optional)</label><textarea id="m_desc" name="description" rows={2} defaultValue={v0.description ?? ""} className={`${inputCls} h-auto py-3 text-base`} /></div>
        </section>

        {/* 4 */}
        <section className={show(4)}>
          <h2 className="text-2xl font-semibold">Check and send</h2>
          <dl className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 text-base">
            <div className="flex justify-between gap-3 p-3"><dt className="text-zinc-500">Vehicle</dt><dd>{vehicle ? <Plate>{vehicle.registration_no}</Plate> : "—"}</dd></div>
            <div className="flex justify-between gap-3 p-3"><dt className="text-zinc-500">Odometer</dt><dd className="font-mono">{odometer ? `${odometer} km` : "—"}</dd></div>
            <div className="flex justify-between gap-3 p-3"><dt className="text-zinc-500">Reason</dt><dd className="text-right">{reasonLabel ?? "—"}</dd></div>
            <div className="p-3"><dt className="mb-1 text-zinc-500">Problem</dt><dd className="whitespace-pre-wrap">{cause || "—"}</dd></div>
            <div className="flex justify-between gap-3 p-3"><dt className="text-zinc-500">Priority</dt><dd className="capitalize">{priority}</dd></div>
            <div className="flex justify-between gap-3 p-3"><dt className="text-zinc-500">Estimate</dt><dd className="font-mono">PKR {money(estimate)}</dd></div>
          </dl>
          <p className="text-sm text-zinc-500">Goes to a Fleet Manager for approval. You can&apos;t approve your own job card.</p>
          <Notice state={state} />
        </section>

        <div className="flex gap-3 pt-1">
          {step === 4 ? <><Draft /><Send disabled={!step1Ok || !step2Ok} /></> : (
            <>
              {step === 2 && <Draft />}
              <button type="button" disabled={(step === 1 && !step1Ok) || (step === 2 && !step2Ok)} onClick={() => setStep(step + 1)} className="h-12 flex-1 rounded-lg bg-brand text-base font-semibold text-white disabled:opacity-50">Next</button>
            </>
          )}
        </div>
        {step === 1 && !step1Ok && vehicleId !== "" && <p className="text-sm text-zinc-500">Enter the dashboard reading to continue.</p>}
        {step === 2 && !step2Ok && <p className="text-sm text-zinc-500">Choose a reason and describe the problem (at least 10 characters) to continue.</p>}
      </div>
    </form>
  );
}
