"use server";
// Choosing the new password (ADR-019). Not a public page: the person arrives here signed in by the one-time link in the
// reset email (see /auth/callback), so only someone who opened that email can reach it.
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { authEvent } from "@/lib/activity/auth";

const MIN_PASSWORD = 10;   // the same rule as sign-up

async function resetPasswordActionImpl(_prev: FormState, form: FormData): Promise<FormState> {
  const password = String(form.get("password") ?? "");
  if (password.length < MIN_PASSWORD) return { error: "Fix the highlighted fields.", fields: { password: `Use at least ${MIN_PASSWORD} characters` } };
  if (password !== String(form.get("confirm") ?? "")) return { error: "Fix the highlighted fields.", fields: { confirm: "The two passwords do not match" } };
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { error: "This link has expired or was already used. Ask for a new one." };
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (/password/i.test(error.message)) return { error: "Fix the highlighted fields.", fields: { password: "Choose a different, stronger password" } };
    return { error: "We could not change your password. Try again in a moment." };
  }
  await supabase.auth.signOut({ scope: "others" });   // anyone else signed in with the old password is signed out
  redirect("/");
}

export async function resetPasswordAction(...args: Parameters<typeof resetPasswordActionImpl>): Promise<Awaited<ReturnType<typeof resetPasswordActionImpl>>> {
  return authEvent("reset password", args, () => resetPasswordActionImpl(...args));
}
