"use client";
import { useActionState } from "react";
import { Input, Notice, Submit } from "@/components/form";
import type { FormState } from "../actions-util";
import { saveEmployeeAction } from "./actions";

type Emp = { id: string; full_name: string; employee_no: string | null; department: string | null; email: string | null; phone: string | null; active: boolean };

export function EmployeeForm({ slug, employee }: { slug: string; employee?: Emp }) {
  const [state, action] = useActionState<FormState, FormData>(saveEmployeeAction.bind(null, slug, employee?.id ?? ""), {});
  // An edit form shows the saved values unless a failed save sent the typed ones back.
  const s: FormState = employee && !state.values
    ? { ...state, values: { full_name: employee.full_name, employee_no: employee.employee_no ?? "", department: employee.department ?? "", email: employee.email ?? "", phone: employee.phone ?? "" } }
    : state;
  return (
    <form action={action} className="grid grid-cols-1 gap-3 sm:grid-cols-2" noValidate>
      <Input name="full_name" label="Full name" state={s} required />
      <Input name="employee_no" label="Employee number" state={s} />
      <Input name="department" label="Department" state={s} />
      <Input name="phone" label="Phone" state={s} inputMode="tel" />
      <Input name="email" label="Email" state={s} type="email" />
      {employee && <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={employee.active} /> Active</label>}
      <div className="flex items-center gap-3 sm:col-span-2"><Submit>{employee ? "Save" : "Add employee"}</Submit><Notice state={state} /></div>
    </form>
  );
}
