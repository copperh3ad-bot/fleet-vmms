"use client";
import { useActionState } from "react";
import { Input, Notice } from "@/components/form";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { resetPasswordAction } from "./actions";

export function ResetForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(resetPasswordAction, {});
  return (
    <form action={action} noValidate className="mt-5 space-y-4">
      <Input name="password" label="New password" type="password" state={state} autoComplete="new-password" hint="At least 10 characters" required />
      <Input name="confirm" label="Type it again" type="password" state={state} autoComplete="new-password" required />
      <Notice state={state} />
      <button type="submit" disabled={pending} className="h-11 w-full rounded-md bg-brand font-medium text-white disabled:opacity-60">{pending ? "Saving" : "Save the new password"}</button>
    </form>
  );
}
