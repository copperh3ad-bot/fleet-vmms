"use client";
import { useActionState } from "react";
import { Input, Notice, Select, Submit } from "@/components/form";
import type { FormState } from "../../actions-util";
import { changeCustodyAction, endCustodyAction, setStatusAction } from "../actions";

export function CustodyForms({ slug, vehicleId, employees, hasHolder }: {
  slug: string; vehicleId: string; employees: { id: string; full_name: string; employee_no: string | null }[]; hasHolder: boolean;
}) {
  const [cs, change] = useActionState<FormState, FormData>(changeCustodyAction.bind(null, slug, vehicleId), {});
  const [es, end] = useActionState<FormState, FormData>(endCustodyAction.bind(null, slug, vehicleId), {});
  return (
    <div className="space-y-3">
      <form action={change} className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_12rem_auto]">
        <Select name="employee_id" label={hasHolder ? "Change to" : "Assign to"} state={cs} blank="Choose a person" required
          options={employees.map((e) => [e.id, e.employee_no ? `${e.full_name} (${e.employee_no})` : e.full_name])} />
        <Input name="from" label="From (today if empty)" type="date" state={cs} />
        <Submit>{hasHolder ? "Change custody" : "Assign"}</Submit>
      </form>
      <Notice state={cs} />
      {hasHolder && (
        <form action={end} className="flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-3">
          <Input name="on" label="Return date (today if empty)" type="date" state={es} />
          <Submit pendingText="Saving">Return to pool</Submit>
          <Notice state={es} />
        </form>
      )}
    </div>
  );
}

export function StatusForm({ slug, vehicleId, current }: { slug: string; vehicleId: string; current: string }) {
  const [s, action] = useActionState<FormState, FormData>(setStatusAction.bind(null, slug, vehicleId), {});
  return (
    <form action={action} className="mt-3 flex items-end gap-2">
      <Select name="status" label="Status" state={{ ...s, values: { status: s.values?.status ?? current } }}
        options={[["active", "Active"], ["in_workshop", "In workshop"], ["inactive", "Inactive"], ["disposed", "Disposed"]]} blank="Choose" />
      <Submit>Update</Submit>
      <Notice state={s} />
    </form>
  );
}
