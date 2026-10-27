// The facts the Terms and the Privacy policy state about who is behind the service. They are the owner's to give, so they come from
// the operator settings (/admin/settings), never from the code. A fact that has not been entered shows as a [bracketed] placeholder,
// so the page cannot quietly say something that was never decided, and the launch check in the browser test keeps flagging it.
export const LOCK_RETENTION_DAYS = 30;

export type LegalFacts = { name: string; address: string; registration: string | null; law: string; support: string; privacy: string };

const or = (v: string | undefined, placeholder: string) => (v?.trim() ? v.trim() : `[${placeholder}]`);

export function legalFacts(s: Record<string, string>): LegalFacts {
  const support = s.support_email?.trim();
  return {
    name: or(s.seller_legal_name, "legal name: set Seller name in Settings"),
    address: or(s.legal_address, "registered address: set it in Settings"),
    registration: s.legal_registration?.trim() || null,
    law: or(s.legal_jurisdiction, "governing law and courts: set it in Settings"),
    support: or(support, "support email: set it in Settings"),
    privacy: or(support, "privacy contact: set the support email in Settings"),
  };
}
