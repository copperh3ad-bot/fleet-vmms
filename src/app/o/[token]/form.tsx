"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { sendReadingAction, type LinkFormState } from "./actions";

function Go() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="h-14 w-full rounded-xl bg-brand text-lg font-semibold text-white disabled:opacity-60">{pending ? "Sending" : "Send reading"}</button>;
}

export function ReadingForm({ token }: { token: string }) {
  const [state, action] = useActionState<LinkFormState, FormData>(sendReadingAction.bind(null, token), {});
  if (state.done) return <p role="status" className="rounded-xl border border-green-200 bg-green-50 p-5 text-lg text-green-900">Thank you. Your reading was sent.</p>;
  return (
    <form action={action} className="flex flex-1 flex-col gap-5" noValidate>
      <div>
        <label htmlFor="reading" className="mb-2 block font-medium">What does the dashboard show now?</label>
        <input id="reading" name="reading" inputMode="decimal" autoComplete="off" autoFocus defaultValue={state.value ?? ""} placeholder="e.g. 79,420" aria-invalid={!!state.error}
          className="h-16 w-full rounded-xl border border-zinc-300 bg-white px-4 font-mono text-2xl text-zinc-900 placeholder:text-zinc-600" />
        {state.error ? <p role="alert" className="mt-2 text-red-700">{state.error}</p> : <p className="mt-2 text-sm text-zinc-500">Numbers only, in kilometres. This link works once.</p>}
      </div>
      <div className="mt-auto pt-6"><Go /></div>
    </form>
  );
}
