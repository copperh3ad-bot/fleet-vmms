// Checks that a call really comes from Supabase (ADR-024). Supabase signs each hook call with the "Standard Webhooks"
// scheme: three headers (id, timestamp, signature) and an HMAC-SHA256 over "<id>.<timestamp>.<body>" with a shared
// secret that looks like "v1,whsec_<base64>". A call that fails any of this is refused before anything is read from it.
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 300;

export type WebhookHeaders = { id: string | null; timestamp: string | null; signature: string | null };

/** The key bytes inside a secret written as "v1,whsec_<base64>" (the prefixes are optional). */
export function secretKey(secret: string): Buffer {
  return Buffer.from(secret.trim().replace(/^v1,/, "").replace(/^whsec_/, ""), "base64");
}

export function signWebhook(secret: string, id: string, timestamp: string, body: string): string {
  return createHmac("sha256", secretKey(secret)).update(`${id}.${timestamp}.${body}`).digest("base64");
}

export function verifyWebhook(secret: string, body: string, h: WebhookHeaders, nowMs = Date.now()): boolean {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowMs / 1000 - ts) > TOLERANCE_SECONDS) return false;
  const want = Buffer.from(signWebhook(secret, h.id, h.timestamp, body));
  // The header may carry several signatures, separated by spaces, each as "v1,<base64>".
  return h.signature.split(" ").some((part) => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const got = Buffer.from(sig);
    return got.length === want.length && timingSafeEqual(got, want);
  });
}
