"use server";
// The only server action reachable without signing in (ADR-006). It takes one number. The token is never logged.
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { DEAD_LINK, hashToken, submitViaLink } from "@/lib/odometer/link";

export type LinkFormState = { error?: string; done?: boolean; value?: string; hoursValue?: string };

const TEN_MIN = 600;

export async function sendReadingAction(token: string, _prev: LinkFormState, form: FormData): Promise<LinkFormState> {
  const value = String(form.get("reading") ?? "");
  const hours = String(form.get("hours") ?? "");
  const driver = getDriver();
  const [ipOk, tokenOk] = await Promise.all([
    allowShared(driver, `link-send-ip:${await clientIp()}`, 30, TEN_MIN),
    allowShared(driver, `link-send-token:${hashToken(token)}`, 10, TEN_MIN),
  ]);
  if (!ipOk || !tokenOk) return { error: "Too many tries. Wait a few minutes and try again.", value };
  const result = await submitViaLink(driver, token, value, hours);
  if (result === "ok") return { done: true };
  if (result === "bad_value") return { error: hours.trim() !== "" || value.trim() === "" ? "Enter the odometer and the hour meter as numbers, like 48210 and 1250.5. At least one is needed." : "Enter the odometer as a number, like 48210.", value, hoursValue: hours };
  return { error: DEAD_LINK };
}
