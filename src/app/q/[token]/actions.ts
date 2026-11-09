"use server";
// The only server actions reachable without signing in for workshops (ADR-030, ADR-033): one takes an estimate, the other an invoice. The token is never logged.
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { hashToken } from "@/lib/odometer/link";
import { DEAD_QUOTE_LINK, submitViaInvoiceLink, submitViaQuoteLink, submitViaTripQuoteLink } from "@/lib/vendorflow/link";
import { estimateFromForm, invoiceFromForm } from "@/lib/vendorflow/form";

export type QuoteFormState = { error?: string; done?: boolean };

const TEN_MIN = 600;

export async function sendEstimateAction(token: string, _prev: QuoteFormState, form: FormData): Promise<QuoteFormState> {
  const driver = getDriver();
  const [ipOk, tokenOk] = await Promise.all([
    allowShared(driver, `quote-send-ip:${await clientIp()}`, 30, TEN_MIN),
    allowShared(driver, `quote-send-token:${hashToken(token)}`, 10, TEN_MIN),
  ]);
  if (!ipOk || !tokenOk) return { error: "Too many tries. Wait a few minutes and try again." };
  const r = await submitViaQuoteLink(driver, token, estimateFromForm(form));
  if (r.ok) return { done: true };
  if (r.reason === "bad_input") return { error: r.message };
  return { error: DEAD_QUOTE_LINK };
}

/** One invoice. Lines that start from the approved estimate carry its line id, so the fleet office sees what was billed against what was approved. */
export async function sendInvoiceAction(token: string, _prev: QuoteFormState, form: FormData): Promise<QuoteFormState> {
  const driver = getDriver();
  const [ipOk, tokenOk] = await Promise.all([
    allowShared(driver, `invoice-send-ip:${await clientIp()}`, 30, TEN_MIN),
    allowShared(driver, `invoice-send-token:${hashToken(token)}`, 10, TEN_MIN),
  ]);
  if (!ipOk || !tokenOk) return { error: "Too many tries. Wait a few minutes and try again." };
  const r = await submitViaInvoiceLink(driver, token, invoiceFromForm(form));
  if (r.ok) return { done: true };
  if (r.reason === "bad_input") return { error: r.message };
  return { error: DEAD_QUOTE_LINK };
}

/** One quote for one trip from a logistics provider (ADR-078). */
export async function sendTripQuoteAction(token: string, _prev: QuoteFormState, form: FormData): Promise<QuoteFormState> {
  const driver = getDriver();
  const [ipOk, tokenOk] = await Promise.all([
    allowShared(driver, `tripquote-send-ip:${await clientIp()}`, 30, TEN_MIN),
    allowShared(driver, `tripquote-send-token:${hashToken(token)}`, 10, TEN_MIN),
  ]);
  if (!ipOk || !tokenOk) return { error: "Too many tries. Wait a few minutes and try again." };
  const text = (k: string) => String(form.get(k) ?? "");
  const r = await submitViaTripQuoteLink(driver, token, { amount: text("amount"), vehicle_text: text("vehicle_text"), driver_text: text("driver_text"), notes: text("notes"), valid_until: text("valid_until") });
  if (r.ok) return { done: true };
  if (r.reason === "bad_input") return { error: r.message };
  return { error: DEAD_QUOTE_LINK };
}
