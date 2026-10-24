"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";

/** `done` means the session cookie is set: the page then moves on itself (see login/page.tsx). */
export type LoginState = { error?: string; done?: boolean };

const TEN_MIN = 600;

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  // Slows down password guessing: per address and per account, across all servers. Counted before the attempt.
  const driver = getDriver();
  const [ipOk, mailOk] = await Promise.all([
    allowShared(driver, `login-ip:${await clientIp()}`, 30, TEN_MIN),
    allowShared(driver, `login-email:${email.toLowerCase()}`, 8, TEN_MIN),
  ]);
  if (!ipOk || !mailOk) return { error: "Too many attempts. Wait a few minutes and try again." };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  // One message for every failure, so the form never reveals which emails exist.
  if (error) return { error: "That email and password do not match." };
  // Not redirect("/"): the server builds that address from the host it believes it has, which can differ from the one the
  // person is on (a custom domain with and without www). The browser moves on with a plain relative address instead.
  return { done: true };
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
