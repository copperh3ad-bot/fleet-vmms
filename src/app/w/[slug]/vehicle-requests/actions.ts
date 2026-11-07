"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { requestVehicle, transitionVehicleRequest } from "@/lib/vehicle-requests/service";
import { runAction, str, typed, type FormState } from "../actions-util";

export async function requestVehicleAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  let id = "";
  const state = await runAction(slug, async (m) => {
    id = await requestVehicle(getDriver(), m, { for_employee: str(form, "for_employee"), reason: str(form, "reason"), vehicle_class: str(form, "vehicle_class"), needed_from: str(form, "needed_from") });
    return "Requested.";
  });
  if (state.ok) { refresh(); redirect(`/w/${slug}/vehicle-requests/${id}`); }
  return { ...state, values: typed(form) };
}

/** One button per next step; `to` is bound by the page. The note and the vehicle come from the form. */
export async function vehicleRequestStepAction(slug: string, id: string, to: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await transitionVehicleRequest(getDriver(), m, id, to, { note: str(form, "note"), vehicleId: str(form, "vehicle_id") });
    return "Done.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}
