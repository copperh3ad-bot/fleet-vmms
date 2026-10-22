"use server";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { UserError } from "@/lib/master/service";
import { acceptInvitation } from "@/lib/admin/service";

export type AcceptState = { error?: string };

/** A signed-in person accepts an invitation addressed to their confirmed email. The service checks that again. */
export async function acceptPendingAction(invitationId: string): Promise<AcceptState> {
  const user = await requireUser();
  let slug: string;
  try {
    slug = (await acceptInvitation(getDriver(), { id: invitationId }, { id: user.id, email: user.email, emailConfirmed: !!user.email_confirmed_at })).slug;
  } catch (e) {
    if (e instanceof UserError) return { error: e.message };
    throw e;
  }
  redirect(`/w/${slug}`);
}
