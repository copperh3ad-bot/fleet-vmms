"use client";
import { useActionState } from "react";
import { Notice } from "@/components/form";
import { btn } from "@/components/ui";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { postManualAction } from "../actions";

const box = "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm";

/** A manual entry of up to four lines. It must balance: the same amount of debit and credit. */
export function ManualEntryForm({ accounts }: { accounts: { code: string; name: string }[] }) {
  const [state, run, pending] = useActionState<FormState, FormData>(postManualAction, {});
  return (
    <form action={run} className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <label className="text-xs text-zinc-500">Currency<input name="currency" defaultValue="PKR" className={`${box} mt-1 block w-24`} /></label>
        <label className="min-w-64 flex-1 text-xs text-zinc-500">What it is for<input name="memo" className={`${box} mt-1 block w-full`} placeholder="Bank charges for October" /></label>
      </div>
      <datalist id="acct-codes">{accounts.map((a) => <option key={a.code} value={a.code}>{a.name}</option>)}</datalist>
      <div className="space-y-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex flex-wrap gap-3">
            <input name={`account${i}`} list="acct-codes" aria-label={`Line ${i + 1} account`} placeholder="Account" className={`${box} w-36`} />
            <input name={`debit${i}`} inputMode="decimal" aria-label={`Line ${i + 1} debit`} placeholder="Debit" className={`${box} w-32`} />
            <input name={`credit${i}`} inputMode="decimal" aria-label={`Line ${i + 1} credit`} placeholder="Credit" className={`${box} w-32`} />
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-3"><button type="submit" disabled={pending} className={`${btn} disabled:opacity-60`}>{pending ? "Posting" : "Post entry"}</button><Notice state={state} /></div>
    </form>
  );
}
