"use server";
// Asking for a password reset (ADR-019). Open to anyone, so it does as little as possible: check the address looks like
// one, slow down repeats, and ask Supabase to send the email. The answer is the same whether or not the address has an
// account, so the form cannot be used to find out who is a customer.
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { origin } from "@/lib/origin";
import { supabaseServer } from "@/lib/supabase/server";
import type { FormState } from "@/app/w/[slug]/actions-util";

const HOUR = 3600;

export async function forgotPasswordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return { error: "Enter the email address you sign in with.", values: { email } };
  const driver = getDriver();
  // Counted before the attempt, per address and per account, across all servers.
  const [ipOk, mailOk] = await Promise.all([allowShared(driver, `forgot-ip:${await clientIp()}`, 8, HOUR), allowShared(driver, `forgot-email:${email}`, 3, HOUR)]);
  if (!ipOk || !mailOk) return { error: "Too many tries. Wait a little and try again.", values: { email } };
  const supabase = await supabaseServer();
  // The answer is ignored on purpose. The link comes back through /auth/callback, which sends this person on to /reset-password.
  await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${await origin()}/auth/callback?next=reset` });
  return { ok: "If that address has an account, an email with a link to choose a new password is on its way. It can take a minute; look in spam or junk too.", values: { email } };
}
