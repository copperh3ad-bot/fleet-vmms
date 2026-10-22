"use client";
import { useActionState } from "react";
import { Notice, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { removeAttachmentAction, uploadAttachmentsAction } from "../actions";

export function UploadForm({ slug, id }: { slug: string; id: string }) {
  const [state, action] = useActionState<FormState, FormData>(uploadAttachmentsAction.bind(null, slug, id), {});
  return (
    <form action={action} className="space-y-2">
      <label htmlFor="files" className="block text-xs font-medium text-zinc-600">Photos or PDF (up to 10 MB each)</label>
      {/* On a phone this offers the camera as well as the gallery */}
      <input id="files" name="files" type="file" multiple accept="image/*,application/pdf" className="block w-full text-sm" />
      <div className="flex flex-wrap items-center gap-3"><Submit pendingText="Uploading">Add files</Submit><Notice state={state} /></div>
    </form>
  );
}

export function RemoveFile({ slug, attachmentId }: { slug: string; attachmentId: string }) {
  const [state, action] = useActionState<FormState>(removeAttachmentAction.bind(null, slug, attachmentId), {});
  return (
    <form action={action} className="inline">
      <button type="submit" className="text-xs text-zinc-600 underline">Remove</button>
      {state.error && <span role="alert" className="ml-2 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
