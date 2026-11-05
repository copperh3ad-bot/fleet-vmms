"use client";
import { useState, type FormEvent } from "react";
import { createAccountAction, sendCodeAction, type InviteFormState } from "./actions";

const box = "h-12 w-full rounded-md border border-zinc-300 bg-white px-3 text-zinc-900";

export function CreateAccountForm({ token, email, username, reset, codeHint }: { token: string; email: string | null; username: string | null; reset: boolean; codeHint: string | null }) {
  const [state, setState] = useState<InviteFormState>({});
  const [pending, setPending] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<{ sentTo?: string; error?: string } | null>(null);

  async function sendCode() {
    if (sending) return;
    setSending(true);
    setSent(await sendCodeAction(token).catch(() => ({ error: "Something went wrong. Try again." })));
    setSending(false);
  }

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
      {username && (
        <>
          <div>
            <label htmlFor="recovery" className="mb-1 block text-sm font-medium">{reset ? "Your recovery code" : "Choose a recovery code"}</label>
            <input id="recovery" name="recovery" type="password" inputMode="numeric" autoComplete="off" className={box} aria-describedby="rc-hint" />
            <p id="rc-hint" className="mt-1 text-xs text-zinc-500">
              {reset
                ? "The code you chose when you first set up your account. Your administrator does not have it."
                : "6 to 12 digits. Keep it to yourself and write it down. If you forget your password you will need it to choose a new one. Nobody else can see it, including your administrator."}
            </p>
          </div>
          {!reset && (
            <div>
              <label htmlFor="recovery_confirm" className="mb-1 block text-sm font-medium">Type the recovery code again</label>
              <input id="recovery_confirm" name="recovery_confirm" type="password" inputMode="numeric" autoComplete="off" className={box} />
            </div>
          )}
        </>
      )}
      {codeHint && (
        <div className="space-y-2 rounded-md border border-zinc-200 bg-zinc-50 p-3">
          <p className="text-sm">To make sure this invitation is yours, we send a 6-digit code to {codeHint}.</p>
          <button type="button" onClick={sendCode} disabled={sending} className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 disabled:opacity-60">{sending ? "Sending" : sent?.sentTo ? "Send me a new code" : "Send me a code"}</button>
          {sent?.sentTo && <p role="status" className="text-sm text-green-900">Code sent to {sent.sentTo}.</p>}
          {sent?.error && <p role="alert" className="text-sm text-red-700">{sent.error}</p>}
          <div>
            <label htmlFor="code" className="mb-1 block text-sm font-medium">The 6-digit code</label>
            <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} className={box} />
          </div>
        </div>
      )}
      {state.error && <p role="alert" className="text-sm text-red-700">{state.error}</p>}
      <button type="submit" disabled={pending} className="h-12 w-full rounded-md bg-sky-800 px-5 text-lg font-medium text-white disabled:opacity-60">{pending ? "Please wait" : reset ? "Save my new password" : "Create my account"}</button>
    </form>
  );
}
