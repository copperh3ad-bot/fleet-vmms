// Where the one-time code on an invitation goes (ADR-041, extended by ADR-046). Kept free of database code so the invitation page and the sender
// agree on one answer. `INVITE_CODE_CHANNEL` (set in Netlify, not a secret) chooses:
//   unset or "auto"  WhatsApp, when it is set up and the invitation has a phone number. This is how it has worked since ADR-041.
//   "email"          the invitation's email address when it has one and mail sending is set up, otherwise WhatsApp as above.
//   "whatsapp"       the same as auto, written out.
//   "off"            no code is asked for on any invitation. Use it if the code cannot be delivered, so invitations are not blocked.
// A password-reset link never asks for a code: its recovery code protects it.
import { emailConfigured } from "@/lib/email/send";
import { whatsappConfigured } from "@/lib/whatsapp";

export type CodeChannel = "email" | "whatsapp";
export type InviteTarget = { email: string | null; phone: string | null; reset: boolean };

export function codeChannel(inv: InviteTarget, setting: string | undefined = process.env.INVITE_CODE_CHANNEL): CodeChannel | null {
  if (inv.reset) return null;
  const mode = (setting ?? "auto").trim().toLowerCase();
  if (mode === "off") return null;
  if (mode === "email" && inv.email && emailConfigured()) return "email";
  if (inv.phone && whatsappConfigured()) return "whatsapp";
  return null;
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
  return channel === "email" ? `your email ${maskEmail(inv.email!)}` : `WhatsApp, to the number ${maskPhone(inv.phone!)}`;
}
