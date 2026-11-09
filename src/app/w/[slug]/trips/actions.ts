"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { awardTripQuote, createTripInvoiceLink, createTripQuoteLink, verifyTripInvoice, declineTripQuote, recordTripQuote, requestTripQuotes, requestTrip, setPoolCar, transitionTrip } from "@/lib/trips/service";
import { origin } from "@/lib/origin";
import { UserError } from "@/lib/master/service";
import { sendTemplate, whatsappConfigured } from "@/lib/whatsapp";
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

export type TripLinkState = FormState & { send?: { text: string; digits: string; e164: string; display: string; vendor: string } };

/** A fresh single-use link for one provider, handed to the sender's own WhatsApp or messages app. The link goes to the provider's own number and is not shown on screen. */
export async function tripQuoteLinkAction(slug: string, quoteId: string, _prev: TripLinkState): Promise<TripLinkState> {
  const base = await origin();
  let send: TripLinkState["send"];
  const state = await runAction(slug, async (m) => {
    const l = await createTripQuoteLink(getDriver(), m, quoteId);
    send = {
      text: `Fleet OTG: please send your quote for trip ${l.trip_no} using this link (works once, valid 7 days): ${base}/q/${l.token}`,
      digits: l.phone.digits, e164: l.phone.e164, display: l.phone.display, vendor: l.vendor_name,
    };
    return "Link ready.";
  });
  return { ...state, send };
}

/** The request sent to the provider's WhatsApp from Fleet OTG itself: an approved template with a button to the one-time link. */
export async function tripQuoteWhatsappAction(slug: string, quoteId: string, _prev: FormState): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    const template = process.env.WHATSAPP_TRIP_QUOTE_TEMPLATE;
    if (!whatsappConfigured() || !template) throw new UserError("Sending on WhatsApp from Fleet OTG is not set up yet. Use the phone button.");
    const l = await createTripQuoteLink(getDriver(), m, quoteId);
    try {
      // the template reads: "{provider}, {company} asks for your quote for trip {no}"
      await sendTemplate(l.phone.e164, { name: template, params: [l.vendor_name, m.tenantName || "A Fleet OTG customer", l.trip_no], buttonUrlSuffix: l.token });
    } catch (e) {
      console.error(`trip quote whatsapp request failed: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"}`);   // never the number or the link
      throw new UserError("The WhatsApp message could not be sent. Try again, or use the phone button.");
    }
    return `Sent to ${l.vendor_name} on WhatsApp.`;
  });
  if (state.ok) refresh();
  return state;
}

/** A fresh single-use link for the awarded provider's invoice on a completed trip, handed to the sender's own WhatsApp or messages app. */
export async function tripInvoiceLinkAction(slug: string, tripId: string, _prev: TripLinkState): Promise<TripLinkState> {
  const base = await origin();
  let send: TripLinkState["send"];
  const state = await runAction(slug, async (m) => {
    const l = await createTripInvoiceLink(getDriver(), m, tripId);
    send = {
      text: `Fleet OTG: please send your invoice for trip ${l.trip_no} using this link (works once, valid 7 days): ${base}/q/${l.token}`,
      digits: l.phone.digits, e164: l.phone.e164, display: l.phone.display, vendor: l.vendor_name,
    };
    return "Link ready.";
  });
  return { ...state, send };
}

/** Finance checks a provider's invoice. */
export async function verifyTripInvoiceAction(slug: string, invoiceId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    const decision = str(form, "decision");
    await verifyTripInvoice(getDriver(), m, invoiceId, decision, str(form, "note"));
    return decision === "return" ? "Returned to the provider." : "Checked.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}
