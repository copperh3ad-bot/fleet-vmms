// The rules for sign-in names (ADR-025), kept free of server code so the invite form in the browser and the server use the same ones.

/** A domain with no mail server. A made-up login address is a random name on it. */
export const LOGIN_EMAIL_DOMAIN = "login.fleetotg.com";
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const RESERVED = new Set(["admin", "administrator", "root", "support", "system", "owner", "operator", "fleetotg", "fleet-otg", "noreply", "no-reply", "info", "help", "billing", "security", "postmaster", "webmaster"]);

export const normalizeUsername = (s: string) => s.trim().toLowerCase();
export const isLoginEmail = (email: string) => email.trim().toLowerCase().endsWith(`@${LOGIN_EMAIL_DOMAIN}`);

/** What someone typed in the "email or username" box. An email always has an @; a name never does. */
export const looksLikeEmail = (s: string) => s.includes("@");

export function checkUsername(raw: string): { ok: true; username: string } | { ok: false; message: string } {
  const username = normalizeUsername(raw);
  if (!username) return { ok: false, message: "Choose a sign-in name." };
  if (!USERNAME_RE.test(username)) return { ok: false, message: "Use 3 to 30 letters, numbers, dots, dashes or underscores, starting with a letter or number." };
  if (RESERVED.has(username)) return { ok: false, message: "That name is not available. Choose another." };
  return { ok: true, username };
}

/** The company and the employee code make a name people already know: "acme" and "E-101" become "acme.e-101". The administrator can change it. */
export function suggestUsername(...parts: string[]): string {
  const clean = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9._-]+/g, "").replace(/^[._-]+|[._-]+$/g, "");
  const base = parts.map(clean).filter(Boolean).join(".").slice(0, 30).replace(/[._-]+$/g, "");
  return USERNAME_RE.test(base) ? base : "";
}
