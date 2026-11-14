"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { UserError } from "@/lib/master/service";
import { acceptInvitation, joinLicenceProblem, type LicenceInput } from "@/lib/admin/service";

export type AcceptState = { error?: string };

/** A signed-in person accepts an invitation addressed to their confirmed email. The service checks that again. */
export async function acceptPendingAction(invitationId: string, _prev: AcceptState, form: FormData): Promise<AcceptState> {
  const user = await requireUser();
  const licence: LicenceInput = { licence_no: String(form.get("licence_no") ?? ""), licence_class: String(form.get("licence_class") ?? ""), licence_expires_on: String(form.get("licence_expires_on") ?? "") };
  // The service asks for a licence only when the person has none on file; whatever was typed is checked there.
  if (form.has("licence_no")) { const bad = joinLicenceProblem(licence); if (bad) return { error: bad }; }
  let slug: string;
  try {
    slug = (await acceptInvitation(getDriver(), { id: invitationId }, { id: user.id, email: user.email, emailConfirmed: !!user.email_confirmed_at }, licence)).slug;
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  redirect(`/w/${slug}`);
}
