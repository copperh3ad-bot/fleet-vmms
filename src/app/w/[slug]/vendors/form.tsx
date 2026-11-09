"use client";
import { useActionState } from "react";
import { Input, Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../actions-util";
import { saveVendorAction, setVendorStatusAction } from "./actions";

type Vendor = { id: string; name: string; kind: string; categories: string[]; contact: string | null; phone: string | null; email: string | null };

export function VendorForm({ slug, vendor }: { slug: string; vendor?: Vendor }) {
  const [state, action] = useActionState<FormState, FormData>(saveVendorAction.bind(null, slug, vendor?.id ?? ""), {});
  const s: FormState = vendor && !state.values
    ? { ...state, values: { name: vendor.name, kind: vendor.kind, categories: vendor.categories.join(", "), contact: vendor.contact ?? "", phone: vendor.phone ?? "", email: vendor.email ?? "" } }
    : state;
  const p = `vendor-${vendor?.id ?? "new"}-`;   // several of these forms share a page; ids must differ
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      <Select id={p + "kind"} name="kind" label="Type" state={s.values ? s : { ...s, values: { kind: "workshop" } }} options={[["logistics", "Logistics provider (trips)"]]} blank="Workshop (repairs and services)" />
      <Input id={p + "name"} name="name" label="Name" state={s} required />
      <Input id={p + "categories"} name="categories" label="Categories" state={s} hint="Comma separated: engine, tyres, electrical" />
      <Input id={p + "contact"} name="contact" label="Contact person" state={s} />
      <Input id={p + "phone"} name="phone" label="Phone" state={s} inputMode="tel" />
      <Input id={p + "email"} name="email" label="Email" state={s} type="email" />
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
