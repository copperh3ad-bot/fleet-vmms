"use client";
import { useActionState } from "react";
import { Input, Notice } from "@/components/form";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { forgotPasswordAction } from "./actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(forgotPasswordAction, {});
  return (
    <form action={action} noValidate className="mt-5 space-y-4">
      <Input name="email" label="Your email address" type="email" state={state} autoComplete="email" required />
      <Notice state={state} />
      <button type="submit" disabled={pending} className="h-11 w-full rounded-md bg-brand font-medium text-white disabled:opacity-60">{pending ? "Sending" : "Send the reset link"}</button>
    </form>
  );
}
