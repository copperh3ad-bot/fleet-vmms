"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { isLoginEmail, loginEmailFor, looksLikeEmail } from "@/lib/auth/login-names";

/** `done` means the session cookie is set: the page then moves on itself (see login/page.tsx). */
export type LoginState = { error?: string; done?: boolean };

const TEN_MIN = 600;

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  // One box for both kinds of person: an email, or the sign-in name of someone who has no email (ADR-025).
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email or sign-in name, and your password." };
  // Slows down password guessing: per address and per account, across all servers. Counted before the attempt.
  const driver = getDriver();
  const [ipOk, mailOk] = await Promise.all([
    allowShared(driver, `login-ip:${await clientIp()}`, 30, TEN_MIN),
    allowShared(driver, `login-email:${email.toLowerCase()}`, 8, TEN_MIN),
  ]);
  if (!ipOk || !mailOk) return { error: "Too many attempts. Wait a few minutes and try again." };
  // A sign-in name is turned into the made-up address behind it. The made-up address itself is not accepted here: nobody knows it.
  const loginEmail = isLoginEmail(email) ? null : looksLikeEmail(email) ? email : await loginEmailFor(driver, email);
  const supabase = await supabaseServer();
  const { error } = loginEmail ? await supabase.auth.signInWithPassword({ email: loginEmail, password }) : { error: new Error("no such sign-in") };
  // One message for every failure, so the form never reveals which emails or names exist.
  if (error) return { error: "That email or sign-in name and password do not match." };
  // Not redirect("/"): the server builds that address from the host it believes it has, which can differ from the one the
  // person is on (a custom domain with and without www). The browser moves on with a plain relative address instead.
  return { done: true };
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
