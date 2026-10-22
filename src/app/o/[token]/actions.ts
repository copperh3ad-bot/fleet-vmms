"use server";
// The only server action reachable without signing in (ADR-006). It takes one number. The token is never logged.
import { getDriver } from "@/lib/db";
import { allow } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { DEAD_LINK, hashToken, submitViaLink } from "@/lib/odometer/link";

export type LinkFormState = { error?: string; done?: boolean; value?: string };

const TEN_MIN = 10 * 60 * 1000;

export async function sendReadingAction(token: string, _prev: LinkFormState, form: FormData): Promise<LinkFormState> {
  const value = String(form.get("reading") ?? "");
  if (!allow(`ip:${await clientIp()}`, 30, TEN_MIN) || !allow(`tok:${hashToken(token)}`, 10, TEN_MIN)) return { error: "Too many tries. Wait a few minutes and try again.", value };
  const result = await submitViaLink(getDriver(), token, value);
  if (result === "ok") return { done: true };
  if (result === "bad_value") return { error: "Enter the odometer as a number, like 48210.", value };
  return { error: DEAD_LINK };
}
