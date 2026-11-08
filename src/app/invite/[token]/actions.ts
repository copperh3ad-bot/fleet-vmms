"use server";
// The second action reachable without signing in (ADR-012). It creates a login for the exact email on a live
// invitation, then accepts it. The token is never logged.
import { redirect } from "next/navigation";
import { getDriver } from "@/lib/db";
import { supabaseServer } from "@/lib/supabase/server";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { UserError } from "@/lib/master/service";
import { acceptInvitation, acceptWithUsername, hashInviteToken, previewInvitation } from "@/lib/admin/service";
import { checkInviteCode, sendInviteCode } from "@/lib/admin/invite-otp";
import { authEvent } from "@/lib/activity/auth";

/** `go` is where the browser moves on to once the account is made and the person is signed in. */
export type InviteFormState = { error?: string; notice?: string; go?: string };

const TEN_MIN = 600;
const MIN_PASSWORD = 10;

async function createAccountActionImpl(token: string, _prev: InviteFormState, form: FormData): Promise<InviteFormState> {
  const driver = getDriver();
  const [ipOk, tokenOk] = await Promise.all([
    allowShared(driver, `invite-ip:${await clientIp()}`, 20, TEN_MIN),
    allowShared(driver, `invite-token:${hashInviteToken(token)}`, 10, TEN_MIN),
  ]);
  if (!ipOk || !tokenOk) return { error: "Too many tries. Wait a few minutes and try again." };
  const invite = await previewInvitation(driver, token);
  if (!invite) return { error: "This invitation is not working. Ask for a new one." };
  const password = String(form.get("password") ?? "");
  if (password.length < MIN_PASSWORD) return { error: `Choose a password of at least ${MIN_PASSWORD} characters.` };
  if (password !== String(form.get("confirm") ?? "")) return { error: "The two passwords do not match." };

  // The link alone is not enough: the code sent to the employee (on WhatsApp, or by email, ADR-046) must be typed too (ADR-041). Checked before anything is made.
  if (invite.codeRequired) {
    try { await checkInviteCode(driver, token, String(form.get("code") ?? "")); }
    catch (e) { if (e instanceof UserError) return { error: e.message }; throw e; }
  }

  const supabase = await supabaseServer();

  // A person with no email: the app makes their login (or, on a reset link, changes its password), then signs them in with it (ADR-025).
  if (invite.username) {
    try {
      const recovery = String(form.get("recovery") ?? "");
      // On a first set-up the code is typed twice; on a reset it is the code they already chose.
      if (!invite.reset && recovery.replace(/\s+/g, "") !== String(form.get("recovery_confirm") ?? "").replace(/\s+/g, "")) return { error: "The two recovery codes do not match." };
      const done = await acceptWithUsername(driver, token, password, recovery);
      const { error: signInError } = await supabase.auth.signInWithPassword({ email: done.loginEmail, password });
      if (signInError) return { notice: `Your password is set. Sign in with the sign-in name ${invite.username}.` };
      return { go: `/w/${done.slug}` };
    } catch (e) {
      if (e instanceof UserError) return { error: e.message };
      throw e;
    }
  }
  if (!invite.email) return { error: "This invitation is not working. Ask for a new one." };
  const { data, error } = await supabase.auth.signUp({ email: invite.email, password });
  if (error) {
    if (/registered|exists/i.test(error.message)) return { error: "An account with this email already exists. Sign in with it, and your invitation will be waiting on your home page." };
    return { error: "The account could not be created. Try again, or ask for a new invitation." };
  }
  // With email confirmation switched on there is no session yet: the person confirms by email, signs in, and accepts from the first page.
  if (!data.session || !data.user) {
    return { notice: "Check your email and confirm your address, then sign in. Your invitation will be waiting on your home page." };
  }
  let slug: string;
  try {
    slug = (await acceptInvitation(driver, { token }, { id: data.user.id, email: data.user.email, emailConfirmed: !!data.user.email_confirmed_at })).slug;
  } catch (e) {
    if (e instanceof UserError) return { notice: `Your account is ready, but the invitation could not be accepted yet: ${e.message} Sign in and try again from your home page.` };
    throw e;
  }
  redirect(`/w/${slug}`);
}

/** "Send me a code": sends a new one-time code to the place this invitation uses (ADR-046). The answer says only where it went, never the code. */
async function sendCodeActionImpl(token: string): Promise<{ sentTo?: string; error?: string }> {
  const driver = getDriver();
  if (!(await allowShared(driver, `invite-token:${hashInviteToken(token)}`, 10, TEN_MIN))) return { error: "Too many tries. Wait a few minutes and try again." };
  try { return await sendInviteCode(driver, token, await clientIp()); }
  catch (e) { if (e instanceof UserError) return { error: e.message }; throw e; }
}

export async function createAccountAction(...args: Parameters<typeof createAccountActionImpl>): Promise<Awaited<ReturnType<typeof createAccountActionImpl>>> {
  return authEvent("accept invitation", args, () => createAccountActionImpl(...args));
}

export async function sendCodeAction(...args: Parameters<typeof sendCodeActionImpl>): Promise<Awaited<ReturnType<typeof sendCodeActionImpl>>> {
  return authEvent("send invitation code", args, () => sendCodeActionImpl(...args));
}
