"use client";
import { useState, type FormEvent } from "react";
import { createAccountAction, type InviteFormState } from "./actions";

const box = "h-12 w-full rounded-md border border-zinc-300 bg-white px-3 text-zinc-900";

export function CreateAccountForm({ token, email, username, reset }: { token: string; email: string | null; username: string | null; reset: boolean }) {
  const [state, setState] = useState<InviteFormState>({});
  const [pending, setPending] = useState(false);

  // The action is called directly (not as a form action) because of what happens when it succeeds: the link is then used up, the
  // page refreshes, and this form is replaced by "this invitation is not working" before any effect here could run. The code
  // after the await below keeps running even then, so it can still send the person on to their workspace with a full page load.
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const data = new FormData(e.currentTarget);
    setPending(true);
    const result = await createAccountAction(token, {}, data).catch(() => ({ error: "Something went wrong. Try again." }) as InviteFormState);
    if (result.go) { window.location.assign(result.go); setState(result); return; }
    setState(result);
    setPending(false);
  }

  if (state.go) return <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">Ready. Opening your workspace.</p>;
  if (state.notice) return <p role="status" className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-900">{state.notice}</p>;
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div>
        <label htmlFor="identity" className="mb-1 block text-sm font-medium">{email ? "Your email" : "Your sign-in name"}</label>
        <input id="identity" value={email ?? username ?? ""} readOnly className={`${box} bg-zinc-50 text-zinc-600 ${email ? "" : "font-mono"}`} />
        {!email && <p className="mt-1 text-xs text-zinc-500">Remember this: you will type it to sign in, with your password.</p>}
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">{reset ? "Choose a new password" : "Choose a password"}</label>
        <input id="password" name="password" type="password" autoComplete="new-password" className={box} aria-describedby="pw-hint" />
        <p id="pw-hint" className="mt-1 text-xs text-zinc-500">At least 10 characters.</p>
      </div>
      <div>
        <label htmlFor="confirm" className="mb-1 block text-sm font-medium">Type it again</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" className={box} />
      </div>
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="h-12 w-full rounded-md bg-sky-800 px-5 text-lg font-medium text-white disabled:opacity-60">{pending ? "Please wait" : reset ? "Save my new password" : "Create my account"}</button>
    </form>
  );
}
