"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { saveVendor, setVendorStatus } from "@/lib/master/service";
import { runAction, str, typed, type FormState } from "../actions-util";

/** id is "" for a new vendor. Categories are typed as a comma-separated list. */
export async function saveVendorAction(slug: string, id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await saveVendor(getDriver(), m, {
      name: str(form, "name"), kind: str(form, "kind") || "workshop", contact: str(form, "contact"), phone: str(form, "phone"), email: str(form, "email"),
      categories: str(form, "categories").split(",").map((c) => c.trim().toLowerCase()).filter(Boolean),
    }, id || undefined);
    return id ? "Saved." : "Vendor added.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

export async function setVendorStatusAction(slug: string, id: string, status: "active" | "blocked"): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await setVendorStatus(getDriver(), m, id, status);
    return status === "blocked" ? "Vendor blocked." : "Vendor unblocked.";
  });
  if (state.ok) refresh();
  return state;
}
