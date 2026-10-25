"use server";
// Sign-up (ADR-014), open to anyone, so it does as little as possible: check the form, slow down repeats, write one
// waiting row, and ask Supabase to create the login and send the confirmation email. No database is built here; that
// happens only after the email is confirmed (see /setup). The same message comes back whether or not the address is
// already a customer.
import { redirect } from "next/navigation";
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { origin } from "@/lib/origin";
import { supabaseServer } from "@/lib/supabase/server";
import { UserError } from "@/lib/master/service";
import { parseSignup, recordSignup } from "@/lib/orgs/signup";
import { signupsOpen } from "@/lib/orgs/runtime";
import type { FormState } from "@/app/w/[slug]/actions-util";

const HOUR = 3600;
const MIN_PASSWORD = 10;

/** The text fields as typed, sent back after an error. Passwords are never sent back. */
const keep = (form: FormData): Record<string, string> =>
  Object.fromEntries([...form.entries()].filter((e): e is [string, string] => typeof e[1] === "string" && !/password|confirm|^\$/.test(e[0])));

export async function signUpAction(_prev: FormState, form: FormData): Promise<FormState> {
  if (!signupsOpen()) return { error: "Sign-up is not open yet. Please check back soon.", values: keep(form) };
  const driver = getDriver();
  let input;
  try {
    input = parseSignup(Object.fromEntries(["org_name", "contact_name", "email", "phone", "fleet_size", "country", "terms"].map((k) => [k, form.get(k) ?? undefined])));
  } catch (e) {
    if (e instanceof UserError) return { error: e.message, fields: e.fields, values: keep(form) };
    throw e;
  }
  if (!input.country) return { error: "Fix the highlighted fields.", fields: { country: "Choose your country" }, values: keep(form) };
  const password = String(form.get("password") ?? "");
  if (password.length < MIN_PASSWORD) return { error: "Fix the highlighted fields.", fields: { password: `Use at least ${MIN_PASSWORD} characters` }, values: keep(form) };
  if (password !== String(form.get("confirm") ?? "")) return { error: "Fix the highlighted fields.", fields: { confirm: "The two passwords do not match" }, values: keep(form) };

  const [ipOk, mailOk] = await Promise.all([
    allowShared(driver, `signup-ip:${await clientIp()}`, 8, HOUR),
    allowShared(driver, `signup-email:${input.email}`, 4, HOUR),
  ]);
  if (!ipOk || !mailOk) return { error: "Too many tries. Wait a little and try again.", values: keep(form) };

  await recordSignup(driver, input);
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email: input.email, password,
    options: { emailRedirectTo: `${await origin()}/auth/callback`, data: { full_name: input.contact_name } },
  });
  if (error) {
    if (/registered|exists/i.test(error.message)) return { error: "An account with this email already exists. Sign in instead.", values: keep(form) };
    if (/password/i.test(error.message)) return { error: "Fix the highlighted fields.", fields: { password: "Choose a stronger password" }, values: keep(form) };
    return { error: "We could not create your account. Try again in a moment.", values: keep(form) };
  }
  // With email confirmation on, Supabase answers a sign-up for an address that already has a login with a success and an empty
  // identities list (and sends no email) instead of an error. Say so, or the person waits for an email that never comes.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { error: "An account with this email already exists. Sign in instead, or use Forgot your password.", values: keep(form) };
  }
  // With email confirmation switched off there is already a session: go straight on. Otherwise the person confirms first.
  redirect(data.session ? "/setup" : "/signup/check-email");
}

/** Sends the confirmation email again. Says the same thing whether or not the address has an account. */
export async function resendConfirmationAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return { error: "Enter the email address you signed up with.", values: { email } };
  const driver = getDriver();
  const [ipOk, mailOk] = await Promise.all([allowShared(driver, `resend-ip:${await clientIp()}`, 8, HOUR), allowShared(driver, `resend-email:${email}`, 3, HOUR)]);
  if (!ipOk || !mailOk) return { error: "Too many tries. Wait a little and try again.", values: { email } };
  const supabase = await supabaseServer();
  await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${await origin()}/auth/callback` } });   // the answer is ignored on purpose
  return { ok: "If that address is waiting for confirmation, a new email is on its way.", values: { email } };
}
