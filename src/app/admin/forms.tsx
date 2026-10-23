"use client";
import { useActionState, useState, useTransition } from "react";
import { Notice } from "@/components/form";
import { btn } from "@/components/ui";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { proofLinkAction } from "./actions";

type Bound = (prev: FormState, form: FormData) => Promise<FormState>;
const box = "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm";

/** A small form: some fields and a button, with the answer shown next to it. */
export function MiniForm({ action, fields, button, danger }: { action: Bound; fields: { name: string; label: string; type?: string; defaultValue?: string; width?: string; placeholder?: string }[]; button: string; danger?: boolean }) {
  const [state, run, pending] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={run} className="flex flex-wrap items-end gap-3">
      {fields.map((f) => (
        <label key={f.name} className="text-xs text-zinc-500">{f.label}
          <input name={f.name} type={f.type ?? "text"} defaultValue={f.defaultValue} placeholder={f.placeholder} className={`${box} mt-1 block ${f.width ?? "w-40"}`} />
        </label>
      ))}
      <button type="submit" disabled={pending} className={`${btn} ${danger ? "border-red-300 text-red-800" : ""} disabled:opacity-60`}>{pending ? "Working" : button}</button>
      <Notice state={state} />
    </form>
  );
}

/** One on/off button that saves at once. */
export function ToggleButton({ action, label }: { action: () => Promise<FormState>; label: string }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={pending} onClick={() => start(async () => setState(await action()))} className={`${btn} disabled:opacity-60`}>{pending ? "Working" : label}</button>
      <Notice state={state} />
    </span>
  );
}

/** Opens the receipt in a new tab; the link is made on demand and lasts a few minutes. */
export function ProofLink({ claimId }: { claimId: string }) {
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={pending} className="text-sky-800 underline disabled:opacity-60"
        onClick={() => start(async () => { const url = await proofLinkAction(claimId); if (url) { window.open(url, "_blank", "noopener,noreferrer"); setMsg(""); } else setMsg("Could not open the receipt."); })}>View receipt</button>
      {msg && <span role="alert" className="text-xs text-red-700">{msg}</span>}
    </span>
  );
}
