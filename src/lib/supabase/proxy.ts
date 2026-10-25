import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { guardDecision } from "@/lib/auth/routing";

/** Refreshes the session cookie and sends signed-out visitors to /login. Only the two public paths are open. */
export async function updateSession(request: NextRequest) {
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
    return NextResponse.rewrite(url);
  }
  const decision = guardDecision(request.nextUrl.pathname, !!data?.claims);
  if (decision.action === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = decision.to;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
