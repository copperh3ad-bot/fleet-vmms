// The two copies of an invitation link (ADR-049, ADR-041). The invited person's own email always carries the real link. The administrator's screen carries it only when
// the app did not send it from its own WhatsApp number: when it did, the administrator is never handed the link, so nobody can sign up in someone else's name.
// A single blanked variable once served both, and every invitation email went out with an empty "Create my account" button.
export function inviteLinks(origin: string, token: string, hiddenFromAdmin: boolean): { forEmail: string; shown: string } {
  const forEmail = `${origin.replace(/\/+$/, "")}/invite/${token}`;
  return { forEmail, shown: hiddenFromAdmin ? "" : forEmail };
}
