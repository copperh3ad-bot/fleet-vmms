"use client";
import { useFormStatus } from "react-dom";
import type { InputHTMLAttributes, ReactNode } from "react";
import type { FormState } from "@/app/w/[slug]/actions-util";

export const inputCls = "h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-zinc-900 disabled:bg-zinc-100";

export function Field({ label, name, state, hint, children, required }: {
  label: string; name: string; state?: FormState; hint?: string; children?: ReactNode; required?: boolean;
}) {
  const err = state?.fields?.[name];
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-xs font-medium text-zinc-600">{label}{required && <span className="text-red-700"> *</span>}</label>
      {children ?? <input id={name} name={name} className={inputCls} aria-invalid={!!err} />}
      {hint && !err && <p className="mt-1 text-xs text-zinc-500">{hint}</p>}
      {err && <p role="alert" className="mt-1 text-xs text-red-700">{err}</p>}
    </div>
  );
}

type InputProps = { name: string; label: string; state: FormState; hint?: string } & Omit<InputHTMLAttributes<HTMLInputElement>, "name">;

/** Text-like input that keeps what the user typed after a failed save. */
export function Input({ name, label, state, hint, required, ...rest }: InputProps) {
  return (
    <Field label={label} name={name} state={state} hint={hint} required={required}>
      <input id={name} name={name} className={inputCls} defaultValue={state.values?.[name] ?? ""} aria-invalid={!!state.fields?.[name]} {...rest} />
    </Field>
  );
}

export function Select({ name, label, state, options, blank = "Choose", required }: {
  name: string; label: string; state: FormState; options: [string, string][]; blank?: string; required?: boolean;
}) {
  return (
    <Field label={label} name={name} state={state} required={required}>
      <select key={state.values?.[name] ?? ""} id={name} name={name} className={inputCls} defaultValue={state.values?.[name] ?? ""} aria-invalid={!!state.fields?.[name]}>
        <option value="">{blank}</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </Field>
  );
}

export function Submit({ children, pendingText = "Saving" }: { children: ReactNode; pendingText?: string }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending} className="h-10 rounded-md bg-sky-800 px-5 font-medium text-white disabled:opacity-60">{pending ? pendingText : children}</button>;
}

export function Notice({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{state.error}</p>;
  if (state.ok) return <p role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-sm text-green-800">{state.ok}</p>;
  return null;
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-4 text-zinc-900">
      {title && <h2 className="mb-3 text-sm font-semibold">{title}</h2>}
      {children}
    </section>
  );
}
