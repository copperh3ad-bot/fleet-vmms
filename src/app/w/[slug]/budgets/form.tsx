"use client";
import { useActionState } from "react";
import { Input, Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../actions-util";
import { copyBudgetsAction, saveBudgetAction } from "./actions";

export function BudgetForm({ slug, vehicles, initial, editing }: { slug: string; vehicles: [string, string][]; initial: Record<string, string>; editing: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(saveBudgetAction.bind(null, slug), {});
  const s: FormState = state.values ? state : { ...state, values: initial };
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-3" noValidate>
      <input type="hidden" name="id" value={initial.id ?? ""} />
      {editing
        ? <div><p className="mb-1 text-xs font-medium text-zinc-600">Applies to</p><p className="flex h-10 items-center text-sm">{vehicles.find(([id]) => id === initial.vehicle_id)?.[1] ?? "Whole fleet"}</p><input type="hidden" name="vehicle_id" value={initial.vehicle_id ?? ""} /></div>
        : <Select name="vehicle_id" label="Applies to" state={s} blank="Whole fleet" options={vehicles} />}
      <Input name="period_start" label="From" type="date" state={s} required />
      <Input name="period_end" label="To" type="date" state={s} required />
      <Input name="amount" label="Budget amount" state={s} inputMode="decimal" required />
      <div className="sm:col-span-2"><Input name="reason" label={editing ? "Why is it changing? (needed if the amount changes)" : "Note (optional)"} state={s} /></div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-3"><Submit>{editing ? "Save change" : "Add budget"}</Submit>{editing && <a href={`/w/${slug}/budgets`} className="text-sm text-zinc-600 underline">Cancel</a>}<Notice state={state} /></div>
    </form>
  );
}

export function CopyForwardForm({ slug, fromYear }: { slug: string; fromYear: number }) {
  const [state, action] = useActionState<FormState, FormData>(copyBudgetsAction.bind(null, slug, fromYear), {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Submit>Copy {fromYear} budgets to {fromYear + 1}</Submit><Notice state={state} />
    </form>
  );
}
