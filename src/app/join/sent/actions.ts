"use server";
// Typing the code that was sent to the person's WhatsApp, on the page they were sent to after asking to join (ADR-055). Open to anyone, so it does one thing: match a 6-digit code to the
// request the browser's own reference points at. The reference lives in an httpOnly cookie set when the request was made; the code and the reference are never logged.
import { cookies } from "next/headers";
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { UserError } from "@/lib/master/service";
import { JOIN_REF_COOKIE, confirmJoinWithCode, resendJoinCode } from "@/lib/orgs/join";
import { hashToken } from "@/lib/odometer/link";

export type CodeState = { done?: boolean; error?: string; sent?: boolean };
const TEN_MIN = 600;

async function ref(): Promise<string> { return (await cookies()).get(JOIN_REF_COOKIE)?.value ?? ""; }

export async function confirmJoinCodeAction(_prev: CodeState, form: FormData): Promise<CodeState> {
  const r = await ref();
  const driver = getDriver();
  // every try counts, right or wrong, so a code cannot be guessed by trying many
  const [ipOk, refOk] = await Promise.all([
    allowShared(driver, `join-code-ip:${await clientIp()}`, 30, TEN_MIN),
    allowShared(driver, `join-code-ref:${hashToken(r || "none")}`, 12, TEN_MIN),
  ]);
  if (!ipOk || !refOk) return { error: "Too many tries. Wait a few minutes and try again." };
  try { await confirmJoinWithCode(driver, r, String(form.get("code") ?? "")); }
  catch (e) { if (e instanceof UserError) return { error: e.message }; throw e; }
  // the cookie is left alone: changing it would re-render the page without the form and lose the confirmation message. It matches nothing once the request is confirmed, and expires on its own.
  return { done: true };
}

export async function resendJoinCodeAction(_prev: CodeState): Promise<CodeState> {
  const r = await ref();
  const driver = getDriver();
  const [ipOk, refOk] = await Promise.all([
    allowShared(driver, `join-resend-ip:${await clientIp()}`, 10, TEN_MIN),
    allowShared(driver, `join-resend-ref:${hashToken(r || "none")}`, 5, TEN_MIN),
  ]);
  if (!ipOk || !refOk) return { error: "Too many tries. Wait a few minutes and try again." };
  try { await resendJoinCode(driver, r); }
  catch (e) { if (e instanceof UserError) return { error: e.message }; throw e; }
  return { sent: true };
}
