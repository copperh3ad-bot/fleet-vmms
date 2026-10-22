"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { saveEmployee } from "@/lib/master/service";
import { runAction, str, typed, type FormState } from "../actions-util";

/** id is "" for a new employee. */
export async function saveEmployeeAction(slug: string, id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await saveEmployee(getDriver(), m, {
      full_name: str(form, "full_name"), employee_no: str(form, "employee_no"), department: str(form, "department"),
      phone: str(form, "phone"), email: str(form, "email"), active: id ? form.get("active") === "on" : undefined,
    }, id || undefined);
    return id ? "Saved." : "Employee added.";
  });
  if (state.ok) refresh();
  // A failure keeps what was typed (React clears the form after every submit); a success starts fresh.
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}
