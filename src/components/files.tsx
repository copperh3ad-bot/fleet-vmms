"use client";
import { useActionState } from "react";
import { Notice, Submit } from "@/components/form";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { FileInput } from "@/components/file-input";

type Bound = (prev: FormState, form: FormData) => Promise<FormState>;

/** Upload box. `action` is a server action with the workspace and record already bound. */
export function UploadBox({ action }: { action: Bound }) {
  const [state, run] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={run} className="space-y-2">
      <label htmlFor="files" className="block text-xs font-medium text-zinc-600">Photos or PDF (up to 4 MB each; photos are shrunk for you)</label>
      <FileInput className="block w-full text-sm" />
      <div className="flex flex-wrap items-center gap-3"><Submit pendingText="Uploading">Add files</Submit><Notice state={state} /></div>
    </form>
  );
}

export function RemoveLink({ action }: { action: () => Promise<FormState> }) {
  const [state, run] = useActionState<FormState>(action, {});
  return (
    <form action={run} className="inline">
      <button type="submit" className="text-xs text-zinc-600 underline">Remove</button>
      {state.error && <span role="alert" className="ml-2 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
