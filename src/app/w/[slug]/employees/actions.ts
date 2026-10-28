"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { saveEmployee } from "@/lib/master/service";
import { runAction, str, typed, type FormState } from "../actions-util";

/** Editing an employee that exists. A new employee is never made here: employees are added with an invitation on the Users page (ADR-040). */
export async function saveEmployeeAction(slug: string, id: string, _prev: FormState, form: FormData): Promise<FormState> {
  if (!id) return { error: "An employee is added together with an invitation. Use Invite on the Users page." };
  const state = await runAction(slug, async (m) => {
    await saveEmployee(getDriver(), m, {
      full_name: str(form, "full_name"), employee_no: str(form, "employee_no"), department: str(form, "department"),
      phone: str(form, "phone"), email: str(form, "email"), active: form.get("active") === "on",
    }, id);
    return "Saved.";
  });
  if (state.ok) refresh();
  // A failure keeps what was typed (React clears the form after every submit); a success starts fresh.
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}
