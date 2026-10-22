"use client";
import { useActionState } from "react";
import { Input, Notice, Submit } from "@/components/form";
import type { FormState } from "../actions-util";
import { saveVendorAction, setVendorStatusAction } from "./actions";

type Vendor = { id: string; name: string; categories: string[]; contact: string | null; phone: string | null; email: string | null };

export function VendorForm({ slug, vendor }: { slug: string; vendor?: Vendor }) {
  const [state, action] = useActionState<FormState, FormData>(saveVendorAction.bind(null, slug, vendor?.id ?? ""), {});
  const s: FormState = vendor && !state.values
    ? { ...state, values: { name: vendor.name, categories: vendor.categories.join(", "), contact: vendor.contact ?? "", phone: vendor.phone ?? "", email: vendor.email ?? "" } }
    : state;
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      <Input name="name" label="Workshop name" state={s} required />
      <Input name="categories" label="Categories" state={s} hint="Comma separated: engine, tyres, electrical" />
      <Input name="contact" label="Contact person" state={s} />
      <Input name="phone" label="Phone" state={s} inputMode="tel" />
      <Input name="email" label="Email" state={s} type="email" />
      <div className="flex items-center gap-3 sm:col-span-2"><Submit>{vendor ? "Save" : "Add vendor"}</Submit><Notice state={state} /></div>
    </form>
  );
}

export function VendorStatusButton({ slug, id, status }: { slug: string; id: string; status: "active" | "blocked" }) {
  const [state, action] = useActionState<FormState>(setVendorStatusAction.bind(null, slug, id, status), {});
  return (
    <form action={action}>
      <button className="text-sm text-zinc-700 underline" type="submit">{status === "blocked" ? "Block" : "Unblock"}</button>
      {state.error && <span role="alert" className="ml-2 text-xs text-red-700">{state.error}</span>}
    </form>
  );
}
