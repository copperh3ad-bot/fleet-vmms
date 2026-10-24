"use client";
import { useActionState } from "react";
import { Input, Notice, Select } from "@/components/form";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { contactAction } from "./actions";

const TOPICS: [string, string][] = [
  ["sales", "Questions before I sign up"], ["support", "Help with my account"], ["billing", "Payment or invoice"], ["other", "Something else"],
];

export function ContactForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(contactAction, {});
  if (state.ok) return <p role="status" className="rounded-md border border-green-200 bg-green-50 p-4 text-green-900">{state.ok}</p>;
  return (
    <form action={action} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="name" label="Your name" state={state} autoComplete="name" required />
        <Input name="email" label="Email address" type="email" state={state} autoComplete="email" required />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="company" label="Company (optional)" state={state} autoComplete="organization" />
        <Select name="topic" label="What is it about?" state={state} options={TOPICS} required />
      </div>
      <div>
        <label htmlFor="message" className="mb-1 block text-xs font-medium text-zinc-600">Your message<span className="text-red-700"> *</span></label>
        <textarea id="message" name="message" rows={6} maxLength={2000} defaultValue={state.values?.message ?? ""} aria-invalid={!!state.fields?.message}
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-zinc-900" />
        {state.fields?.message && <p role="alert" className="mt-1 text-xs text-red-700">{state.fields.message}</p>}
      </div>
      {/* A trap for scripts: hidden from people and from screen readers, never filled in by a real visitor. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden"><label>Leave this empty<input name="website" tabIndex={-1} autoComplete="off" /></label></div>
      <Notice state={state} />
      <button type="submit" disabled={pending} className="h-11 rounded-md bg-brand px-6 font-medium text-white disabled:opacity-60">{pending ? "Sending" : "Send message"}</button>
    </form>
  );
}
