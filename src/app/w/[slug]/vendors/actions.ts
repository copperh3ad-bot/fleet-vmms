"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { saveVendor, setVendorStatus } from "@/lib/master/service";
import { removeProviderRate, saveProviderRate } from "@/lib/trips/outsourced";
import { setWaMenu } from "@/lib/wa-menu/switch";
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

/** A reference rate for a logistics provider (ADR-078). The organization's own figure; it never replaces a quote. */
export async function addRateAction(slug: string, vendorId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await saveProviderRate(getDriver(), m, { vendor_id: vendorId, label: str(form, "label"), basis: str(form, "basis"), amount: str(form, "amount"), notes: str(form, "notes") });
    return "Rate saved.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

export async function removeRateAction(slug: string, rateId: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await removeProviderRate(getDriver(), m, rateId); return "Removed."; });
  if (state.ok) refresh();
  return state;
}

/** The administrator switches the WhatsApp menu on or off (ADR-079). */
export async function setWaMenuAction(slug: string, on: boolean, _prev: FormState): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await setWaMenu(getDriver(), m, on); return on ? "The WhatsApp menu is on." : "The WhatsApp menu is off."; });
  if (state.ok) refresh();
  return state;
}
