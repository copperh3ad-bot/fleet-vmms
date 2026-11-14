"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { createRole, deleteRole, renameRole, setRolePermissions } from "@/lib/admin/roles";
import { runAction, str, typed, type FormState } from "../actions-util";

/** Save the ticked permissions of one role (ADR-097). Anything not ticked is taken away. */
export async function saveRoleAction(slug: string, roleKey: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    const r = await setRolePermissions(getDriver(), m, roleKey, form.getAll("perm").map(String));
    return r.added || r.removed ? `Saved: ${r.added} added, ${r.removed} taken away. It applies the next time each person opens a page.` : "Nothing changed.";
  });
  if (state.ok) refresh();
  return state;
}

export async function createRoleAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await createRole(getDriver(), m, { name: str(form, "name"), copy_from: str(form, "copy_from") });
    return "Role made. Tick what it may do, then give it to people from the list above.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

export async function renameRoleAction(slug: string, roleKey: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await renameRole(getDriver(), m, roleKey, str(form, "name")); return "Renamed."; });
  if (state.ok) refresh();
  return state;
}

export async function deleteRoleAction(slug: string, roleKey: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await deleteRole(getDriver(), m, roleKey); return "Role deleted."; });
  if (state.ok) refresh();
  return state;
}
