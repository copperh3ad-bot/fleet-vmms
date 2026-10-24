"use server";
import { refresh } from "next/cache";
import { getDriver } from "@/lib/db";
import { approveJoinRequest, declineJoinRequest, setJoinCode } from "@/lib/orgs/join";
import { runAction, str, type FormState } from "../actions-util";

export async function joinCodeAction(slug: string, action: "on" | "regenerate" | "off"): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await setJoinCode(getDriver(), m, action);
    return action === "off" ? "Joining with a code is switched off." : action === "regenerate" ? "New code made. The old one no longer works." : "Joining with a code is on.";
  });
  if (state.ok) refresh();
  return state;
}

export async function approveJoinAction(slug: string, id: string, _prev: FormState, form: FormData): Promise<FormState> {
  const state = await runAction(slug, async (m) => {
    await approveJoinRequest(getDriver(), m, id, { role: str(form, "role"), vehicle_scope: str(form, "vehicle_scope"), employee_no: str(form, "employee_no") });
    return "Approved. They will see the invitation when they sign in.";
  });
  if (state.ok) refresh();
  return state;
}

export async function declineJoinAction(slug: string, id: string): Promise<FormState> {
  const state = await runAction(slug, async (m) => { await declineJoinRequest(getDriver(), m, id); return "Request declined."; });
  if (state.ok) refresh();
  return state;
}
