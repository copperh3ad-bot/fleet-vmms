"use client";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createAccountAction, type InviteFormState } from "./actions";

function Go() {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="h-12 w-full rounded-md bg-sky-800 px-5 text-lg font-medium text-white disabled:opacity-60">{pending ? "Creating" : "Create my account"}</button>;
}

const box = "h-12 w-full rounded-md border border-zinc-300 bg-white px-3 text-zinc-900";

export function CreateAccountForm({ token, email }: { token: string; email: string }) {
  const [state, action] = useActionState<InviteFormState, FormData>(createAccountAction.bind(null, token), {});
  if (state.notice) return <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">{state.notice}</p>;
  return (
    <form action={action} className="space-y-3" noValidate>
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">Your email</label>
        <input id="email" value={email} readOnly className={`${box} bg-zinc-50 text-zinc-600`} />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">Choose a password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" className={box} aria-describedby="pw-hint" />
        <p id="pw-hint" className="mt-1 text-xs text-zinc-500">At least 10 characters.</p>
      </div>
      <div>
        <label htmlFor="confirm" className="mb-1 block text-sm font-medium">Type it again</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" className={box} />
      </div>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <Go />
    </form>
  );
}
