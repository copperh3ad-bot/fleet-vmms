"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { awardTripQuote, declineTripQuote, recordTripQuote, requestTripQuotes, requestTrip, setPoolCar, transitionTrip } from "@/lib/trips/service";
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

/** Ask the chosen logistics providers for a quote on this trip (ADR-078). */
export async function askQuotesAction(slug: string, id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    const n = await requestTripQuotes(getDriver(), m, id, form.getAll("vendor_id").map(String));
    return n ? `Quote asked from ${n} provider${n === 1 ? "" : "s"}.` : "They were already asked.";
  });
  if (state.ok) refresh();
  return state;
}

export async function recordQuoteAction(slug: string, quoteId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await recordTripQuote(getDriver(), m, quoteId, { amount: str(form, "amount"), vehicle_text: str(form, "vehicle_text"), driver_text: str(form, "driver_text"), notes: str(form, "notes"), valid_until: str(form, "valid_until") });
    return "Quote saved.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

export async function declineQuoteAction(slug: string, quoteId: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await declineTripQuote(getDriver(), m, quoteId); return "Marked as declined."; });
  if (state.ok) refresh();
  return state;
}

export async function awardQuoteAction(slug: string, id: string, quoteId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await awardTripQuote(getDriver(), m, id, quoteId, str(form, "note")); return "Awarded."; });
  if (state.ok) refresh();
  return state.error ? { ...state, values: typed(form) } : state;
}
