"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { createCargoRequest, makeTripFromCargo, transitionCargo } from "@/lib/cargo/service";
import { runAction, str, typed, type FormState } from "../actions-util";

export async function requestCargoAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  let id = "";
  const state = await runAction(slug, async (m) => {
    id = (await createCargoRequest(getDriver(), m, {
      description: str(form, "description"), quantity_text: str(form, "quantity_text"), pickup_place: str(form, "pickup_place"), pickup_contact: str(form, "pickup_contact"), pickup_phone: str(form, "pickup_phone"),
      pickup_at: str(form, "pickup_at"), drop_place: str(form, "drop_place"), drop_contact: str(form, "drop_contact"), drop_phone: str(form, "drop_phone"), deliver_by: str(form, "deliver_by"),
      handling: str(form, "handling"), department: str(form, "department"),
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
export async function makeTripAction(slug: string, id: string): Promise<FormState> {
  let tripId = "";
  const state = await runAction(slug, async (m) => { tripId = await makeTripFromCargo(getDriver(), m, id); return "Trip requested."; });
  if (state.ok) { refresh(); redirect(`/w/${slug}/trips/${tripId}`); }
  return state;
}
