"use client";
import { useActionState } from "react";
import { Input, Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../actions-util";
import { addChallanAction, challanStatusAction } from "../compliance/actions";

export function ChallanForm({ slug, vehicles, people }: { slug: string; vehicles: [string, string][]; people: [string, string][] }) {
  const [state, action] = useActionState<FormState, FormData>(addChallanAction.bind(null, slug), {});
  // after a successful save the boxes are cleared; after an error they keep what was typed
  const s: FormState = state.ok ? { ...state, values: {} } : state;
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-3" noValidate>
      <Select name="vehicle_id" label="Vehicle" state={s} blank="Choose a vehicle" required options={vehicles} />
      <Input name="issued_on" label="Date on the challan" type="date" state={s} required />
      <Input name="amount" label="Amount" state={s} inputMode="decimal" required />
      <Input name="reference" label="Challan number" state={s} />
      <Input name="violation" label="Violation" state={s} />
      <Select name="employee_id" label="Driver" state={s} blank="Whoever held the vehicle then" options={people} />
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3"><Submit>Add challan</Submit><Notice state={state} /></div>
    </form>
  );
}

export function StatusButtons({ slug, id, status }: { slug: string; id: string; status: string }) {
  const [state, action] = useActionState<FormState, FormData>(async (_p, f) => challanStatusAction(slug, id, String(f.get("to")) as "open" | "paid" | "disputed"), {});
  const options = [["paid", "Mark paid"], ["disputed", "Disputed"], ["open", "Reopen"]].filter(([k]) => k !== status);
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      {options.map(([k, l]) => <button key={k} name="to" value={k} className="text-xs text-sky-800 underline" type="submit">{l}</button>)}
      {state.error && <span role="alert" className="text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
