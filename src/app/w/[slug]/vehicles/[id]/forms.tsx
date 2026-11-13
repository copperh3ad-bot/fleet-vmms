"use client";
import { useActionState, useState, useTransition } from "react";
import { Input, Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { changeCustodyAction, setCapacityAction, endCustodyAction, recordHoursAction, setDepartmentAction, setStatusAction, setTracksHoursAction } from "../actions";

export function CustodyForms({ slug, vehicleId, employees, hasHolder }: {
  slug: string; vehicleId: string; employees: { id: string; full_name: string; employee_no: string | null }[]; hasHolder: boolean;
}) {
  const [cs, change] = useActionState<FormState, FormData>(changeCustodyAction.bind(null, slug, vehicleId), {});
  const [es, end] = useActionState<FormState, FormData>(endCustodyAction.bind(null, slug, vehicleId), {});
  return (
    <div className="space-y-3">
      <form action={change} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_12rem_auto]">
        <Select name="employee_id" label={hasHolder ? "Change to" : "Assign to"} state={cs} blank="Choose a person" required
          options={employees.map((e) => [e.id, e.employee_no ? `${e.full_name} (${e.employee_no})` : e.full_name])} />
        <Input name="from" label="From (today if empty)" type="date" state={cs} />
        <Submit>{hasHolder ? "Change custody" : "Assign"}</Submit>
      </form>
      <Notice state={cs} />
      {hasHolder && (
        <form action={end} className="flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-3">
          <Input name="on" label="Return date (today if empty)" type="date" state={es} />
          <Submit pendingText="Saving">Return to pool</Submit>
          <Notice state={es} />
        </form>
      )}
    </div>
  );
}

export function StatusForm({ slug, vehicleId, current }: { slug: string; vehicleId: string; current: string }) {
  const [s, action] = useActionState<FormState, FormData>(setStatusAction.bind(null, slug, vehicleId), {});
  return (
    <form action={action} className="mt-3 flex items-end gap-2">
      <Select name="status" label="Status" state={{ ...s, values: { status: s.values?.status ?? current } }}
        options={[["active", "Active"], ["in_workshop", "In workshop"], ["inactive", "Inactive"], ["disposed", "Disposed"]]} blank="Choose" />
      <Submit>Update</Submit>
      <Notice state={s} />
    </form>
  );
}

/** Which department runs this vehicle. Empty is the general fleet. A department with a role tied to it (ADR-048) limits that role to its own vehicles. */
export function DepartmentForm({ slug, vehicleId, current, known }: { slug: string; vehicleId: string; current: string; known: string[] }) {
  const [s, action] = useActionState<FormState, FormData>(setDepartmentAction.bind(null, slug, vehicleId), {});
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
      <Input name="department" label="Operating department" state={{ ...s, values: { department: s.values?.department ?? current } }} list="departments" hint="For example Logistics or Operations. Empty means the general fleet." />
      <datalist id="departments">{known.map((d) => <option key={d} value={d} />)}</datalist>
      <Submit>Save</Submit>
      <Notice state={s} />
    </form>
  );
}

/** What the vehicle can carry, so cargo can be matched to it by weight and by space (ADR-092). */
export function CapacityForm({ slug, vehicleId, kg, m3 }: { slug: string; vehicleId: string; kg: string | null; m3: string | null }) {
  const [s, action] = useActionState<FormState, FormData>(setCapacityAction.bind(null, slug, vehicleId), {});
  return (
    <form action={action} className="mt-3 flex flex-wrap items-end gap-2">
      <Input name="load_capacity_kg" label="Load capacity (kg)" state={{ ...s, values: { load_capacity_kg: s.values?.load_capacity_kg ?? (kg ?? ""), load_volume_m3: s.values?.load_volume_m3 ?? (m3 ?? "") } }} inputMode="decimal" />
      <Input name="load_volume_m3" label="Load space (cubic metres)" state={{ ...s, values: { load_capacity_kg: s.values?.load_capacity_kg ?? (kg ?? ""), load_volume_m3: s.values?.load_volume_m3 ?? (m3 ?? "") } }} inputMode="decimal" hint="Optional. Empty clears it." />
      <Submit>Save</Submit>
      <Notice state={s} />
    </form>
  );
}

/** Switch hour tracking on for a vehicle with an hour meter, and record its reading. */
export function HoursForm({ slug, vehicleId, tracks, hours }: { slug: string; vehicleId: string; tracks: boolean; hours: number | null }) {
  const [s, action] = useActionState<FormState, FormData>(recordHoursAction.bind(null, slug, vehicleId), {});
  const [t, setT] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2 border-t border-zinc-100 pt-3">
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={tracks} disabled={pending} onChange={(e) => start(async () => setT(await setTracksHoursAction(slug, vehicleId, e.target.checked)))} />
        This vehicle has an hour meter (loaders, forklifts, generators)
      </label>
      {t.error && <p role="alert" className="text-sm text-red-700">{t.error}</p>}
      {tracks && (
        <form action={action} className="flex flex-wrap items-end gap-2">
          <Input name="hours" label="Hour meter reading" state={s} inputMode="decimal" hint={hours !== null ? `On file: ${hours.toLocaleString("en-US", { maximumFractionDigits: 1 })} hours.` : "No reading yet."} />
          <Submit>Save reading</Submit>
          <Notice state={s} />
        </form>
      )}
    </div>
  );
}
