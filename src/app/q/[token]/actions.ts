"use server";
// The only server action reachable without signing in for workshops (ADR-030). It takes one estimate. The token is never logged.
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { hashToken } from "@/lib/odometer/link";
import { DEAD_QUOTE_LINK, submitViaQuoteLink } from "@/lib/vendorflow/link";

export type QuoteFormState = { error?: string; done?: boolean };

const TEN_MIN = 600;
const text = (f: FormData, k: string) => String(f.get(k) ?? "");

export async function sendEstimateAction(token: string, _prev: QuoteFormState, form: FormData): Promise<QuoteFormState> {
  const driver = getDriver();
  const [ipOk, tokenOk] = await Promise.all([
    allowShared(driver, `quote-send-ip:${await clientIp()}`, 30, TEN_MIN),
    allowShared(driver, `quote-send-token:${hashToken(token)}`, 10, TEN_MIN),
  ]);
  if (!ipOk || !tokenOk) return { error: "Too many tries. Wait a few minutes and try again." };
  const count = Math.min(Number(text(form, "count")) || 0, 50);
  const lines = [];
  for (let i = 0; i < count; i++) {
    const description = text(form, `description_${i}`).trim();
    const qty = text(form, `qty_${i}`).trim();
    const unit = text(form, `unit_cost_${i}`).trim();
    if (!description && !qty && !unit) continue;
    lines.push({ kind: text(form, `kind_${i}`) || "service", description, qty, unit_cost: unit });
  }
  const r = await submitViaQuoteLink(driver, token, {
    details: text(form, "details"), days_needed: text(form, "days_needed"), valid_until: text(form, "valid_until"), warranty_months: text(form, "warranty_months"), lines,
  });
  if (r.ok) return { done: true };
  if (r.reason === "bad_input") return { error: r.message };
  return { error: DEAD_QUOTE_LINK };
}
