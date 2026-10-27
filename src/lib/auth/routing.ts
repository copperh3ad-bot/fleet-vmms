/**
 * Open without signing in, and nothing else (CLAUDE.md rule 5, ADR-014): the landing page and sign-up (which only record a
 * waiting row and ask Supabase for a login), the two legal pages (static text), the confirmation return (which only turns
 * a code from Supabase into a session), the About us page (static text, ADR-020), the crawler files robots.txt, sitemap.xml, llms.txt and security.txt (static, ADR-023, ADR-031), the Features page (static text, ADR-031), the email hook Supabase calls (signed, ADR-024), the Contact us form (one stored row per message, limited, ADR-021), sign-in, asking for a password-reset email (ADR-019) and the health check. The page
 * for choosing the new password is not here: it is reached only through the signed-in session the emailed link creates. Pages behind them check the person themselves.
 */
export const PUBLIC_PATHS = ["/", "/login", "/forgot-password", "/api/health", "/signup", "/signup/check-email", "/pricing", "/features", "/about", "/contact", "/join", "/join/workshop", "/join/sent", "/terms", "/privacy", "/auth/callback", "/robots.txt", "/sitemap.xml", "/llms.txt", "/.well-known/security.txt", "/api/auth/send-email"];

/** The driver odometer link (ADR-006): exactly one path segment, shaped like a 32-byte base64url token. */
export const ODOMETER_LINK_PATH = /^\/o\/[A-Za-z0-9_-]{43}$/;

/** The workshop estimate link (ADR-030): exactly one path segment, shaped like a 32-byte base64url token. */
export const QUOTATION_LINK_PATH = /^\/q\/[A-Za-z0-9_-]{43}$/;

/** The invitation page (ADR-012): exactly one path segment, shaped like a 32-byte base64url token. */
export const INVITE_LINK_PATH = /^\/invite\/[A-Za-z0-9_-]{43}$/;

/** "next" lets the request through; otherwise redirect to the given path. */
export function guardDecision(pathname: string, signedIn: boolean): { action: "next" } | { action: "redirect"; to: string } {
  if (signedIn || PUBLIC_PATHS.includes(pathname) || ODOMETER_LINK_PATH.test(pathname) || INVITE_LINK_PATH.test(pathname) || QUOTATION_LINK_PATH.test(pathname)) return { action: "next" };
  return { action: "redirect", to: "/login" };
}

/** After sign-in: one workspace goes straight in; none or several show the chooser at "/". */
export function postLoginDestination(spaces: { slug: string }[]): string | null {
  return spaces.length === 1 ? `/w/${spaces[0].slug}` : null;
}
