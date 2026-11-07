"use client";
import { useActionState } from "react";
import { confirmJoinCodeAction, resendJoinCodeAction, type CodeState } from "./actions";

/** The 6-digit code from the WhatsApp message (ADR-055). Nothing reaches the administrator until it is typed. */
export function CodeForm({ company, phoneEnds }: { company: string; phoneEnds: string }) {
  const [state, action, pending] = useActionState<CodeState, FormData>(confirmJoinCodeAction, {});
  const [again, resend, resending] = useActionState<CodeState>(resendJoinCodeAction, {});
  if (state.done) return <p role="status" className="mt-4 rounded-xl border border-green-200 bg-green-50 p-5 text-lg text-green-900">Thank you, you are confirmed. Your administrator will now see your request to join {company} and choose what you can do. You will find your invitation when you sign in.</p>;
  return (
    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-5">
      <p className="text-zinc-900">We sent a 6-digit code on WhatsApp to the number ending <span className="font-mono font-semibold">{phoneEnds}</span>. Type it here. <strong>Your administrator does not see your request until you do.</strong> The code works for 10 minutes.</p>
      <form action={action} className="mt-4 flex flex-wrap items-start gap-3" noValidate>
        <div>
          <label htmlFor="join-code" className="mb-1 block text-sm font-medium">Code from WhatsApp</label>
          <input id="join-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} pattern="[0-9 ]*" placeholder="123456" aria-invalid={!!state.error}
            className="h-14 w-44 rounded-xl border border-zinc-300 bg-white px-4 font-mono text-2xl tracking-widest text-zinc-900" />
        </div>
        <button type="submit" disabled={pending} className="mt-6 h-14 rounded-xl bg-brand px-6 text-lg font-semibold text-white disabled:opacity-60">{pending ? "Checking" : "Confirm"}</button>
      </form>
      {state.error && <p role="alert" className="mt-2 text-red-700">{state.error}</p>}
      <form action={resend} className="mt-3">
        <button type="submit" disabled={resending} className="text-sm text-sky-800 underline disabled:opacity-60">Send me a new code</button>
        {again.sent && <span role="status" className="ml-2 text-sm text-green-800">A new code is on its way.</span>}
        {again.error && <span role="alert" className="ml-2 text-sm text-red-700">{again.error}</span>}
      </form>
    </div>
  );
}
