// Where Supabase sends a person after they click the confirmation link (ADR-014). It does one thing: turn the one-time
// code in the address into a signed-in session, then send them to the first page, which decides where they go. The
// destination is fixed, so it cannot be used to redirect anyone elsewhere, and a bad or reused code just leads to the
// sign-in page. The code is never logged.
import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { origin } from "@/lib/origin";
import { loggedRoute } from "@/lib/activity/route";

const CODE = /^[A-Za-z0-9_-]{8,200}$/;

async function getImpl(request: NextRequest) {
  const base = await origin();
  const code = request.nextUrl.searchParams.get("code") ?? "";
  if (!CODE.test(code)) return NextResponse.redirect(`${base}/login`);
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  // The code only works in the browser that asked for it. Anywhere else the person signs in with the password they chose.
  // The only other destination is the password-reset page (ADR-019), chosen from a fixed word, never from a typed address.
  const dest = request.nextUrl.searchParams.get("next") === "reset" ? "/reset-password" : "/";
  return NextResponse.redirect(error ? `${base}/login` : `${base}${dest}`);
}

export const GET = loggedRoute("auth", "email confirmation link", getImpl);
