"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { createCargoRequest, makeTripFromCargo, setCargoWeight, transitionCargo } from "@/lib/cargo/service";
import { runAction, str, typed, type FormState } from "../actions-util";

export async function requestCargoAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  let id = "";
  const state = await runAction(slug, async (m) => {
    id = (await createCargoRequest(getDriver(), m, {
      department: str(form, "department"), pickup_at: str(form, "pickup_at"), pickup_place: str(form, "pickup_place"), drop_place: str(form, "drop_place"), vehicle_type: str(form, "vehicle_type"),
      description: str(form, "description"), quantity_text: str(form, "quantity_text"), weight_kg: str(form, "weight_kg").replace(/,/g, ""), volume_m3: str(form, "volume_m3").replace(/,/g, ""), poc_details: str(form, "poc_details"), instructions: str(form, "instructions"),
    })).id;
    return "Requested.";
  });
  if (state.ok) { refresh(); redirect(`/w/${slug}/cargo/${id}`); }
  return { ...state, values: typed(form) };
}

/** One button per next step; `to` is bound by the page. */
export async function cargoStepAction(slug: string, id: string, to: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await transitionCargo(getDriver(), m, id, to, str(form, "note")); return "Done."; });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

/** "Make a trip from this": a trip request prefilled from the cargo request, then on to the trip. */
export async function makeTripAction(slug: string, id: string, vehicleId: string | null): Promise<FormState> {
  let tripId = "";
  const state = await runAction(slug, async (m) => { tripId = await makeTripFromCargo(getDriver(), m, id, vehicleId || undefined); return "Trip requested."; });
  if (state.ok) { refresh(); redirect(`/w/${slug}/trips/${tripId}`); }
  return state;
}

/** Logistics enters or corrects the weight so the suggestion can be made. */
export async function setCargoWeightAction(slug: string, id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await setCargoWeight(getDriver(), m, id, str(form, "weight_kg").replace(/,/g, "")); return "Weight saved."; });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}
