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
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser(); // verifies the token with Supabase, not just the cookie
  const decision = guardDecision(request.nextUrl.pathname, !!data.user);
  if (decision.action === "redirect") {
    const url = request.nextUrl.clone();
    url.pathname = decision.to;
    url.search = "";
    return NextResponse.redirect(url);
  }
  return response;
}
