"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { origin } from "@/lib/origin";
import { getDriver } from "@/lib/db";
import { approveNormalReadings, closeCycle, createLinks, enterReading, openCycle, reviewReading, revokeLinks } from "@/lib/odometer/service";
import { runAction, str, typed, type FormState } from "../actions-util";

export type SentLink = { submission_id: string; plate: string; holder_name: string | null; whatsapp: string | null; url: string; expires_at: string };
export type LinksState = FormState & { links?: SentLink[] };

export async function openCycleAction(slug: string, _prev: FormState, form: FormData): Promise<FormState> {
  let id = "";
  const state = await runAction(slug, async (m) => { id = await openCycle(getDriver(), m, str(form, "period"), str(form, "due_on")); return "Cycle opened."; });
  if (state.ok && id) { refresh(); redirect(`/w/${slug}/odometer/${id}`); }
  return { ...state, values: typed(form) };
}

function present(base: string, made: Awaited<ReturnType<typeof createLinks>>): SentLink[] {
  return made.map((l) => {
    const url = `${base}/o/${l.token}`;
    const digits = (l.holder_phone ?? "").replace(/\D/g, "");
    const text = encodeURIComponent(`Please send the odometer reading for ${l.plate} using this link (works once, valid 48 hours): ${url}`);
    return { submission_id: l.submission_id, plate: l.plate, holder_name: l.holder_name, whatsapp: digits.length >= 8 ? `https://wa.me/${digits}?text=${text}` : null, url, expires_at: l.expires_at };
  });
}

/** A reminder for everyone still to send a reading: a fresh single-use link each, shown once for copying or WhatsApp. */
export async function createLinksAction(slug: string, cycleId: string): Promise<LinksState> {
  let links: SentLink[] = [];
  const base = await origin();
  const state = await runAction(slug, async (m) => {
    const made = await createLinks(getDriver(), m, cycleId);
    links = present(base, made);
    return `${made.length} link${made.length === 1 ? "" : "s"} created. They are shown once, copy them now.`;
  });
  if (state.ok) refresh();
  return { ...state, links };
}

/** The same for one vehicle. */
export async function remindOneAction(slug: string, cycleId: string, submissionId: string): Promise<LinksState> {
  let links: SentLink[] = [];
  const base = await origin();
  const state = await runAction(slug, async (m) => {
    links = present(base, await createLinks(getDriver(), m, cycleId, [submissionId]));
    return "New link created. It is shown once, copy it now.";
  });
  if (state.ok) refresh();
  return { ...state, links };
}

export async function approveNormalAction(slug: string, cycleId: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    const n = await approveNormalReadings(getDriver(), m, cycleId);
    return n === 0 ? "No normal readings were waiting." : `${n} reading${n === 1 ? "" : "s"} approved. The vehicles' odometers are updated.`;
  });
  if (state.ok) refresh();
  return state;
}

export async function closeCycleAction(slug: string, cycleId: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await closeCycle(getDriver(), m, cycleId); return "Cycle closed."; });
  if (state.ok) refresh();
  return state;
}

export async function revokeAction(slug: string, submissionId: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await revokeLinks(getDriver(), m, submissionId); return "Link cancelled."; });
  if (state.ok) refresh();
  return state;
}

export async function enterReadingAction(slug: string, submissionId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await enterReading(getDriver(), m, submissionId, str(form, "reading"), str(form, "note")); return "Reading saved for review."; });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}

export async function reviewAction(slug: string, submissionId: string, decision: "approve" | "reject", _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await reviewReading(getDriver(), m, submissionId, decision, str(form, "note"));
    return decision === "approve" ? "Approved. The vehicle's odometer is updated." : "Rejected. Send a new link.";
  });
  if (state.ok) refresh();
  return state.error || state.fields ? { ...state, values: typed(form) } : state;
}
