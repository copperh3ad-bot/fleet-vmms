"use server";
import { cookies } from "next/headers";
import { refresh } from "next/cache";
import { requireMembership } from "@/lib/auth/session";
import { onboardingCookie } from "@/lib/dashboard/onboarding";

/**
 * "Hide this" and "Show the get-started steps". Putting a list away is a preference of this person on this browser, so it is a
 * cookie, not company data; the list itself comes from the company's data and carries nothing private.
 */
export async function hideOnboardingAction(slug: string, hidden: boolean): Promise<void> {
  await requireMembership(slug);
  const jar = await cookies();
  // Showing it again writes "0" with the same attributes rather than deleting: a delete is a different kind of cookie write, and browsers refuse to let one overwrite a secure cookie.
  jar.set(onboardingCookie(slug), hidden ? "1" : "0", { path: `/w/${slug}`, maxAge: 60 * 60 * 24 * 365, sameSite: "lax", secure: true, httpOnly: true });
  refresh();
}
