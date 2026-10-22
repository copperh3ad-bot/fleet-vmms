"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { origin } from "@/lib/origin";
import { changeMember, inviteUser, resendInvitation, revokeInvitation, type NewInvite } from "@/lib/admin/service";
import { runAction, str, typed, type FormState } from "../actions-util";

export type InviteResult = { url: string; email: string; expires_at: string };
export type InviteState = FormState & { invite?: InviteResult };

async function link(base: Promise<string>, i: NewInvite): Promise<InviteResult> {
  return { url: `${await base}/invite/${i.token}`, email: i.email, expires_at: i.expires_at };
}

export async function inviteAction(slug: string, _prev: InviteState, form: FormData): Promise<InviteState> {
  let invite: InviteResult | undefined;
  const base = origin();
  const state = await runAction(slug, async (m) => {
    const made = await inviteUser(getDriver(), m, Object.fromEntries(["full_name", "email", "phone", "role", "vehicle_scope", "vendor_id"].map((k) => [k, str(form, k)])));
    invite = await link(base, made);
    return "Invitation created. Copy the link now; it is shown once.";
  });
  if (state.ok) { refresh(); return { ...state, invite }; }
  return { ...state, values: typed(form) };
}

export async function resendAction(slug: string, id: string): Promise<InviteState> {
  let invite: InviteResult | undefined;
  const base = origin();
  const state = await runAction(slug, async (m) => { invite = await link(base, await resendInvitation(getDriver(), m, id)); return "New link created. The old one no longer works."; });
  if (state.ok) refresh();
  return { ...state, invite };
}

export async function revokeAction(slug: string, id: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await revokeInvitation(getDriver(), m, id); return "Invitation cancelled."; });
  if (state.ok) refresh();
  return state;
}

export async function changeMemberAction(slug: string, userId: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await changeMember(getDriver(), m, userId, { role: str(form, "role"), vehicle_scope: str(form, "vehicle_scope"), status: str(form, "status") });
    return "Saved.";
  });
  if (state.ok) refresh();
  return state;
}
