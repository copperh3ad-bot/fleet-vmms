"use server";
// Joining a company with its code (ADR-016), open to anyone, so it does as little as possible: check the form, slow down
// repeats, write one request that an administrator must approve, and ask Supabase to create the login and send the
// confirmation email. Nothing here gives access to anything.
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { origin } from "@/lib/origin";
import { supabaseServer } from "@/lib/supabase/server";
import { UserError } from "@/lib/master/service";
import { JOIN_REF_COOKIE, parseJoin, submitJoinRequest, type JoinKind } from "@/lib/orgs/join";
import { normalizePhone } from "@/lib/phone";
import { otpChecksOn } from "@/lib/otp-switch";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { authEvent } from "@/lib/activity/auth";

const HOUR = 3600;
const MIN_PASSWORD = 10;

/** The text fields as typed, sent back after an error. Passwords are never sent back. */
const keep = (form: FormData): Record<string, string> =>
  Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !/password|confirm|^\$/.test(e[0])));

async function joinActionImpl(kind: JoinKind, _prev: FormState, form: FormData): Promise<FormState> {
  // Workshops never sign up (ADR-033): an organization adds them itself. The page is gone, and the action refuses the kind so it cannot be called by hand.
  if (kind !== "staff") return { error: "Workshops do not sign up. Ask the company to send you a link or an email.", values: keep(form) };
  const driver = getDriver();
  let input;
  try {
    input = parseJoin(Object.fromEntries(["code", "full_name", "email", "phone", "licence_type", "licence_no", "licence_expires_on", "workshop_name", "note", "terms"].map((k) => [k, form.get(k) ?? undefined])), kind);
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, fields: e.fields, values: keep(form) };
    throw e;
  }
  const password = String(form.get("password") ?? "");
  if (password.length < MIN_PASSWORD) return { error: "Fix the highlighted fields.", fields: { password: `Use at least ${MIN_PASSWORD} characters` }, values: keep(form) };
  if (password !== String(form.get("confirm") ?? "")) return { error: "Fix the highlighted fields.", fields: { confirm: "The two passwords do not match" }, values: keep(form) };

  // Every try counts, right or wrong, so a code cannot be guessed by trying many.
  // and so that nobody can use this form to send WhatsApp messages to a stranger over and over: the number counts too
  const digits = normalizePhone(input.phone);
  const codesOn = await otpChecksOn(driver);
  const [ipOk, mailOk, phoneOk] = await Promise.all([
    allowShared(driver, `join-ip:${await clientIp()}`, 10, HOUR),
    allowShared(driver, `join-email:${input.email}`, 4, HOUR),
    // The per-number limit stops this form being used to send WhatsApp messages to a stranger. With the one-time codes switched off for beta (ADR-076) nothing is sent, and testers share numbers, so it is skipped.
    digits.ok && codesOn ? allowShared(driver, `join-phone:${digits.digits}`, 3, HOUR) : Promise.resolve(true),
  ]);
  if (!ipOk || !mailOk || !phoneOk) return { error: "Too many tries. Wait a little and try again.", values: keep(form) };

  let sentTo = "", confirmed = false;
  try {
    const sent = await submitJoinRequest(driver, kind, input);
    sentTo = sent.phoneEnds;
    confirmed = !!sent.confirmed;
    // the browser's own reference to this request: the code typed on the next page is matched to it (ADR-055). Never readable by scripts. None when no code is asked for (ADR-076).
    if (!confirmed) (await cookies()).set(JOIN_REF_COOKIE, sent.ref, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/join", maxAge: 3 * 24 * 3600 });
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, fields: e.fields, values: keep(form) };
    throw e;
  }

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email: input.email, password,
    options: { emailRedirectTo: `${await origin()}/auth/callback`, data: { full_name: input.full_name } },
  });
  if (error && !/registered|exists/i.test(error.message)) {
    if (/password/i.test(error.message)) return { error: "Fix the highlighted fields.", fields: { password: "Choose a stronger password" }, values: keep(form) };
    return { error: "We could not create your account. Try again in a moment.", values: keep(form) };
  }
  // The request is saved. A person who already has a login simply signs in; their request is waiting either way.
  const existing = !!error || (Array.isArray(data?.user?.identities) && data.user.identities.length === 0);   // Supabase hides an existing login behind a success with no identities
  redirect(`/join/sent?to=${encodeURIComponent(sentTo)}${existing || data?.session ? "&existing=1" : ""}${confirmed ? "&confirmed=1" : ""}`);
}

export async function joinAction(...args: Parameters<typeof joinActionImpl>): Promise<Awaited<ReturnType<typeof joinActionImpl>>> {
  return authEvent("join with company code", args, () => joinActionImpl(...args));
}
