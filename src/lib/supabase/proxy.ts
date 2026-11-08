import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { guardDecision } from "@/lib/auth/routing";

/** Refreshes the session cookie and sends signed-out visitors to /login. Only the two public paths are open. */
async function session(request: NextRequest): Promise<{ res: NextResponse; signedIn: boolean }> {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, { ...options, httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:" || options?.secure }));
      },
    },
  });
  // Verifies the token's signature and expiry here, and renews it when it is close to running out, without a trip to
  // Supabase on every request. This only decides who is sent to the sign-in page; every page and action that shows or
  // changes data still asks Supabase who the person is (requireUser), so a revoked login stops there.
  const { data } = await supabase.auth.getClaims();
  // A signed-out visitor to the home page gets the prebuilt landing page; the address stays "/".
  if (!data?.claims && request.nextUrl.pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = "/welcome";
    return { res: NextResponse.rewrite(url), signedIn: false };
  }
  const decision = guardDecision(request.nextUrl.pathname, !!data?.claims);
  if (decision.action === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = decision.to;
    url.search = "";
    return { res: NextResponse.redirect(url), signedIn: false };
  }
  return { res: response, signedIn: !!data?.claims };
}

/** A cookie a script may read that says only "someone is signed in", so the prebuilt public pages can swap Sign in for Open
 *  workspace without asking the server who is looking. It grants nothing: every page and action still checks the real login.
 *  Written only when it differs from what the browser already has, and corrected on the next visit if the login ends. */
export const SIGNED_IN_FLAG = "fleetotg_in";

export async function updateSession(request: NextRequest) {
  // Set here, on the request the pages see, and overwritten if the browser sent its own: the activity log (ADR-070) trusts these two.
  request.headers.set("x-fleet-path", request.nextUrl.pathname);
  request.headers.set("x-fleet-rid", crypto.randomUUID());
  const { res, signedIn } = await session(request);
  const has = request.cookies.get(SIGNED_IN_FLAG)?.value === "1";
  if (signedIn && !has) res.cookies.set(SIGNED_IN_FLAG, "1", { path: "/", sameSite: "lax", maxAge: 60 * 60 * 24 * 30, secure: request.nextUrl.protocol === "https:" });
  else if (!signedIn && request.cookies.has(SIGNED_IN_FLAG)) res.cookies.set(SIGNED_IN_FLAG, "", { path: "/", maxAge: 0 });
  return res;
}
