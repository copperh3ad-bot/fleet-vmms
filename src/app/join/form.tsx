"use client";
import { useActionState } from "react";
import { Field, Input, Notice, inputCls } from "@/components/form";
import type { FormState } from "@/app/w/[slug]/actions-util";
import type { JoinKind } from "@/lib/orgs/join";
import { joinAction } from "./actions";

/** One form for both kinds: the workshop version asks for the workshop's name and keeps the same code and login fields. */
export function JoinForm({ kind, code }: { kind: JoinKind; code: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(joinAction.bind(null, kind), {});
  const err = state.fields?.terms;
  const workshop = kind === "workshop";
  return (
    <form action={action} noValidate className="space-y-4">
      <Input name="code" label="Company code" state={state} required autoComplete="off" autoCapitalize="characters" spellCheck={false}
        defaultValue={state.values?.code ?? code} hint="Your administrator can give you this. It looks like K7MQ2-X9PTH." />
      {workshop && <Input name="workshop_name" label="Workshop name" state={state} required autoComplete="organization" />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Input name="full_name" label={workshop ? "Contact person" : "Your full name"} state={state} required autoComplete="name" />
        <Input name="phone" label="Your WhatsApp number" state={state} required inputMode="tel" autoComplete="tel" placeholder="+92 300 1234567" hint="We send a message there to confirm it was you. Start with +92, then the number: +92 300 1234567." />
      </div>
      {!workshop && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Input name="licence_no" label="Driving licence number" state={state} required autoComplete="off" />
          <Input name="licence_expires_on" label="Licence expiry date" type="date" state={state} required hint="It must not have expired." />
          <Field label="Type of licence" name="licence_type" state={state} hint="A learner's permit is accepted only if your company allows it.">
            <select id="licence_type" name="licence_type" defaultValue={state.values?.licence_type ?? "full"} className={inputCls} aria-invalid={!!state.fields?.licence_type}>
              <option value="full">Full driving licence</option>
              <option value="learner">Learner&apos;s permit</option>
            </select>
          </Field>
        </div>
      )}
      <Input name="email" label="Email" type="email" state={state} required autoComplete="email" hint="We send a confirmation link here. You sign in with this address." />
      <Field label="Note for the administrator (optional)" name="note" state={state}>
        <textarea id="note" name="note" rows={2} maxLength={500} defaultValue={state.values?.note ?? ""} className={`${inputCls} h-auto py-2`} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Password" name="password" state={state} required hint="At least 10 characters.">
          <input id="password" name="password" type="password" autoComplete="new-password" className={inputCls} aria-invalid={!!state.fields?.password} />
        </Field>
        <Field label="Repeat the password" name="confirm" state={state} required>
          <input id="confirm" name="confirm" type="password" autoComplete="new-password" className={inputCls} aria-invalid={!!state.fields?.confirm} />
        </Field>
      </div>
      <div>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="terms" defaultChecked={state.values?.terms === "on"} className="mt-1" aria-invalid={!!err} />
          <span>I agree to the <a href="/terms" target="_blank" className="underline">Terms</a> and the <a href="/privacy" target="_blank" className="underline">Privacy Policy</a>.</span>
        </label>
        {err && <p role="alert" className="mt-1 text-xs text-red-700">{err}</p>}
      </div>
      <Notice state={state} />
      <button type="submit" disabled={pending} className="h-12 w-full rounded-md bg-brand text-base font-semibold text-white disabled:opacity-60">{pending ? "Sending your request" : "Ask to join"}</button>
      <p className="text-center text-sm text-zinc-500">Already have an account? <a href="/login" className="underline">Sign in</a></p>
    </form>
  );
}
