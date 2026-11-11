"use client";
import { useActionState } from "react";
import { Input, Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../actions-util";
import { saveDepotAction, setDepotActiveAction } from "./actions";

const KINDS: [string, string][] = [["depot", "Depot"], ["office", "Office"], ["yard", "Yard"], ["port", "Port"], ["workshop", "Workshop"], ["site", "Site"], ["other", "Other"]];

/** Add a place, or change one (name, city, kind). */
export function DepotForm({ slug, id = null, initial }: { slug: string; id?: string | null; initial?: { name: string; city: string | null; kind: string } }) {
  const [state, action] = useActionState<FormState, FormData>(saveDepotAction.bind(null, slug, id), initial ? { values: { name: initial.name, city: initial.city ?? "", kind: initial.kind } } : {});
  return (
    <form action={action} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-4" noValidate>
      <Input name="name" label="Name of the place" state={state} required hint={id ? undefined : "For example Lahore depot, Karachi port, Head office."} />
      <Input name="city" label="City" state={state} />
      <Select name="kind" label="Kind" state={state} options={KINDS} blank="" />
      <div className="flex items-center gap-3"><Submit>{id ? "Save" : "Add this place"}</Submit></div>
      <div className="sm:col-span-4"><Notice state={state} /></div>
    </form>
  );
}

export function DepotSwitch({ slug, id, active, name }: { slug: string; id: string; active: boolean; name: string }) {
  const [state, action] = useActionState<FormState, FormData>(setDepotActiveAction.bind(null, slug, id, !active) as (p: FormState, f: FormData) => Promise<FormState>, {});
  return (
    <form action={action} className="inline-flex items-center gap-2">
      <button type="submit" className="text-xs text-sky-800 underline" aria-label={`${active ? "Take off the list" : "Put back on the list"}: ${name}`}>{active ? "Take off the list" : "Put back"}</button>
      <Notice state={state} />
    </form>
  );
}
