// Where the one-time code on an invitation goes (ADR-041, extended by ADR-046; SMS was removed by ADR-058). Kept free of database code so the invitation page and the sender
// agree on one answer. `INVITE_CODE_CHANNEL` (set in Netlify, not a secret) chooses:
// Each setting is an order of preference; the first channel that is set up for that invitation is used, and none means no code is asked for.
//   unset or "auto"  WhatsApp.
//   "whatsapp"       the same as auto, written out.
//   "email"          the invitation's email address, then WhatsApp.
//   "off"            no code is asked for on any invitation. Use it if the code cannot be delivered, so invitations are not blocked.
// WhatsApp needs the invitation's phone number; email needs its email address. Any other value behaves as auto.
// A password-reset link never asks for a code: its recovery code protects it.
import { emailConfigured } from "@/lib/email/send";
import { whatsappConfigured } from "@/lib/whatsapp";

export type CodeChannel = "email" | "whatsapp";
export type InviteTarget = { email: string | null; phone: string | null; reset: boolean };

const ORDER: Record<string, CodeChannel[]> = {
  auto: ["whatsapp"], whatsapp: ["whatsapp"], email: ["email", "whatsapp"],
};

export function codeChannel(inv: InviteTarget, setting: string | undefined = process.env.INVITE_CODE_CHANNEL): CodeChannel | null {
  if (inv.reset) return null;
  const mode = (setting ?? "auto").trim().toLowerCase();
  if (mode === "off") return null;
  const usable = (c: CodeChannel) => c === "email" ? !!inv.email && emailConfigured() : !!inv.phone && whatsappConfigured();
  return (ORDER[mode] ?? ORDER.auto).find(usable) ?? null;
}

/** "j***@example.com": enough for the person to recognise their own address, not enough to learn it. */
export const maskEmail = (email: string) => {
  const at = email.lastIndexOf("@");
  return at < 1 ? "your email" : `${email[0]}***${email.slice(at)}`;
};

/** The last four digits of a phone number, for "the number ending 4567". */
export const maskPhone = (e164: string) => `ending ${e164.replace(/\D/g, "").slice(-4)}`;

/** Where the code goes, in words for the invitation page. Never the whole address or number. */
export function codeHint(channel: CodeChannel, inv: { email: string | null; phone: string | null }): string {
  if (channel === "email") return `your email ${maskEmail(inv.email!)}`;
  return `WhatsApp, to the number ${maskPhone(inv.phone!)}`;
}
