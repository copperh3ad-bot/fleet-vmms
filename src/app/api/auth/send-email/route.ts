// The hook Supabase calls to have the app send a sign-up or password-reset email (ADR-024). The work is in
// src/lib/email/hook.ts. On Netlify the small function netlify/functions/send-email.mts answers this same address first, because
// this server takes about 4 seconds to wake up and Supabase gives up after 5; this route is the same code, kept for any host without it.
import type { NextRequest } from "next/server";
import { handleSendEmailHook } from "@/lib/email/hook";

export const POST = (req: NextRequest) => handleSendEmailHook(req);
