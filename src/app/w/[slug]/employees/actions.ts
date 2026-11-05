"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { saveEmployee } from "@/lib/master/service";
import { removeLicence, saveLicence } from "@/lib/compliance/licences";
import { runAction, str, typed, type FormState } from "../actions-util";

/** Editing an employee that exists. A new employee is never made here: employees are added with an invitation on the Users page (ADR-041). */
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

/** The driving licence of one employee (ADR-044). Saved in place; the same form changes the expiry when the licence is renewed. */
export async function saveLicenceAction(slug: string, employeeId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await saveLicence(getDriver(), m, employeeId, {
      licence_no: str(form, "licence_no"), licence_class: str(form, "licence_class"), issued_on: str(form, "issued_on"), expires_on: str(form, "expires_on"),
      emergency_contact_name: str(form, "emergency_contact_name"), emergency_contact_phone: str(form, "emergency_contact_phone"),
    });
    return "Licence saved.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

export async function removeLicenceAction(slug: string, employeeId: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await removeLicence(getDriver(), m, employeeId); return "Licence removed."; });
  if (state.ok) refresh();
  return state;
}
