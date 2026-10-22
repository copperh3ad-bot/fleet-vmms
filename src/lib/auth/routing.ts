export const PUBLIC_PATHS = ["/login", "/api/health"];

/** The driver odometer link (ADR-006): exactly one path segment, shaped like a 32-byte base64url token. */
export const ODOMETER_LINK_PATH = /^\/o\/[A-Za-z0-9_-]{43}$/;

/** The invitation page (ADR-012): exactly one path segment, shaped like a 32-byte base64url token. */
export const INVITE_LINK_PATH = /^\/invite\/[A-Za-z0-9_-]{43}$/;

/** "next" lets the request through; otherwise redirect to the given path. */
export function guardDecision(pathname: string, signedIn: boolean): { action: "next" } | { action: "redirect"; to: string } {
  if (signedIn || PUBLIC_PATHS.includes(pathname) || ODOMETER_LINK_PATH.test(pathname) || INVITE_LINK_PATH.test(pathname)) return { action: "next" };
  return { action: "redirect", to: "/login" };
}

/** After sign-in: one workspace goes straight in; none or several show the chooser at "/". */
export function postLoginDestination(spaces: { slug: string }[]): string | null {
  return spaces.length === 1 ? `/w/${spaces[0].slug}` : null;
}
