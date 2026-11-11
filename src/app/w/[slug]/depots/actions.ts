"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { saveDepot, setDepotActive } from "@/lib/depots/service";
import { runAction, str, typed, type FormState } from "../actions-util";

export async function saveDepotAction(slug: string, id: string | null, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await saveDepot(getDriver(), m, { name: str(form, "name"), city: str(form, "city"), kind: str(form, "kind") || "depot" }, id ?? undefined);
    return id ? "Saved." : "Added.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state.ok && !id ? { ...state, values: {} } : state;
}

export async function setDepotActiveAction(slug: string, id: string, active: boolean, _prev: FormState): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await setDepotActive(getDriver(), m, id, active); return active ? "Back on the list." : "Taken off the list."; });
  if (state.ok) refresh();
  return state;
}
