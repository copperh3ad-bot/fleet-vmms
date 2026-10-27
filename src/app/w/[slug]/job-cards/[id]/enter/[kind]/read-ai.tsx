"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Notice } from "@/components/form";
import { readWithAiAction } from "../../../actions";
import type { FormState } from "../../../../actions-util";

function Go({ again }: { again: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm font-medium disabled:opacity-60">{pending ? "Reading the file. This takes a few seconds" : again ? "Read it again" : "Read the attached file with AI"}</button>;
}

/** Asks the AI to read the workshop's emailed file and fill the form below as a draft. A person still checks every figure and saves (ADR-034). */
export function ReadWithAi({ slug, jobId, kind, emailId, again }: { slug: string; jobId: string; kind: "quotation" | "invoice"; emailId: string; again: boolean }) {
  const [state, action] = useActionState<FormState, FormData>(readWithAiAction.bind(null, slug, jobId, kind, emailId) as (p: FormState, f: FormData) => Promise<FormState>, {});
  return (
    <form action={action} className="space-y-2">
      <Go again={again} />
      <Notice state={state} />
    </form>
  );
}
