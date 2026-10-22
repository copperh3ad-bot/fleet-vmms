export const PUBLIC_PATHS = ["/login", "/api/health"];

/** "next" lets the request through; otherwise redirect to the given path. */
export function guardDecision(pathname: string, signedIn: boolean): { action: "next" } | { action: "redirect"; to: string } {
  if (signedIn || PUBLIC_PATHS.includes(pathname)) return { action: "next" };
  return { action: "redirect", to: "/login" };
}

/** After sign-in: one workspace goes straight in; none or several show the chooser at "/". */
export function postLoginDestination(spaces: { slug: string }[]): string | null {
  return spaces.length === 1 ? `/w/${spaces[0].slug}` : null;
}
