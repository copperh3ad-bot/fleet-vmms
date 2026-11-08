"use client";
import { useActionState, useState } from "react";
import { Notice } from "@/components/form";
import { btn } from "@/components/ui";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { mergeVehicleNameAction } from "../actions";

const box = "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm";

/** Folds a name into one already on the list: pick the make, and for a model the model. */
export function MergeForm({ id, isModel, targets, label }: { id: string; isModel: boolean; targets: Record<string, string[]>; label: string }) {
  const [state, run, pending] = useActionState<FormState, FormData>(mergeVehicleNameAction.bind(null, id), {});
  const makes = Object.keys(targets).sort((a, b) => a.localeCompare(b));
  const [make, setMake] = useState("");
  return (
    <form action={run} className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-zinc-500">{label}
        <select name="into_make" value={make} onChange={(e) => setMake(e.target.value)} className={`${box} mt-1 block w-44`} aria-label={`${label}: make`}>
          <option value="">Choose a make</option>{makes.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </label>
      {isModel && (
        <label className="text-xs text-zinc-500">Model
          <select name="into_model" className={`${box} mt-1 block w-44`} disabled={!make} aria-label="Model to merge into">
            <option value="">{make ? "Choose a model" : "Choose a make first"}</option>{(targets[make] ?? []).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      )}
      <button type="submit" disabled={pending || !make} className={`${btn} disabled:opacity-60`}>{pending ? "Working" : "Merge"}</button>
      <Notice state={state} />
    </form>
  );
}
