"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { requestTrip, setPoolCar, transitionTrip } from "@/lib/trips/service";
import { runAction, str, typed, type FormState } from "../actions-util";

export async function requestTripAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  let id = "";
  const state = await runAction(slug, async (m) => {
    id = await requestTrip(getDriver(), m, {
      kind: str(form, "kind") || "trip", stops: str(form, "stops"), purpose: str(form, "purpose"), from_place: str(form, "from_place"), to_place: str(form, "to_place"), start_at: str(form, "start_at"), end_at: str(form, "end_at"),
      passengers: str(form, "passengers"), preferred_vehicle_id: str(form, "preferred_vehicle_id"),
    });
    return "Requested.";
  });
  if (state.ok) { refresh(); redirect(`/w/${slug}/trips/${id}`); }
  return { ...state, values: typed(form) };
}

/** One button per next step; `to` is bound by the page. The note, vehicle, driver and odometer come from the form. */
export async function tripStepAction(slug: string, id: string, to: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await transitionTrip(getDriver(), m, id, to, { note: str(form, "note"), vehicleId: str(form, "vehicle_id"), driverId: str(form, "driver_id"), odometer: str(form, "odometer") });
    return "Done.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

/** The pool-car switch on the Trips page: one car, on or off. */
export async function poolCarAction(slug: string, vehicleId: string, pool: boolean): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await setPoolCar(getDriver(), m, vehicleId, pool); return pool ? "Added to the pool." : "Taken out of the pool."; });
  if (state.ok) refresh();
  return state;
}
