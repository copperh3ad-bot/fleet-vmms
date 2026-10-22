"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { sendReadingAction, type LinkFormState } from "./actions";

function Go() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="h-12 w-full rounded-md bg-sky-800 px-5 text-lg font-medium text-white disabled:opacity-60">{pending ? "Sending" : "Send reading"}</button>;
}

export function ReadingForm({ token }: { token: string }) {
  const [state, action] = useActionState<LinkFormState, FormData>(sendReadingAction.bind(null, token), {});
  if (state.done) return <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-green-900">Thank you. Your reading was sent.</p>;
  return (
    <form action={action} className="space-y-3" noValidate>
      <div>
        <label htmlFor="reading" className="mb-1 block text-sm font-medium">Odometer (km)</label>
        <input id="reading" name="reading" inputMode="decimal" autoComplete="off" autoFocus defaultValue={state.value ?? ""} aria-invalid={!!state.error}
          className="h-14 w-full rounded-md border border-zinc-300 bg-white px-3 text-2xl tabular-nums text-zinc-900" />
      </div>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <Go />
    </form>
  );
}
