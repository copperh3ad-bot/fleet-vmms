"use client";
import { useActionState } from "react";
import { Notice, Submit } from "@/components/form";
import { FileInput } from "@/components/file-input";
import type { FormState } from "../../actions-util";

type Bound = (prev: FormState, form: FormData) => Promise<FormState>;

/** One upload box for the vehicle's photo or its registration scan. `action` has the workspace, vehicle and kind bound. */
export function VehicleFileUpload({ action, label, accept }: { action: Bound; label: string; accept: string }) {
  const [state, run] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={run} className="space-y-2">
      <label className="block text-xs font-medium text-zinc-600">{label}</label>
      <FileInput id={`f-${label}`} name="file" multiple={false} accept={accept} className="block w-full rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-3 text-sm" />
      <div className="flex flex-wrap items-center gap-3"><Submit pendingText="Uploading">Add</Submit><Notice state={state} /></div>
    </form>
  );
}

export function VehicleFileRemove({ action }: { action: () => Promise<FormState> }) {
  const [state, run] = useActionState<FormState>(action, {});
  return (
    <form action={run} className="inline">
      <button type="submit" className="text-xs text-zinc-600 underline">Remove</button>
      {state.error && <span role="alert" className="ml-2 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
