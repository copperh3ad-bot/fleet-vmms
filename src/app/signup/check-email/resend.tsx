"use client";
import { useActionState } from "react";
import { Input, Notice } from "@/components/form";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { resendConfirmationAction } from "../actions";

export function ResendForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(resendConfirmationAction, {});
  return (
    <form action={action} noValidate className="mt-3 space-y-3">
      <Input name="email" label="Your email address" type="email" state={state} autoComplete="email" required />
      <Notice state={state} />
      <button type="submit" disabled={pending} className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium hover:bg-zinc-50 disabled:opacity-60">{pending ? "Sending" : "Send the email again"}</button>
    </form>
  );
}
