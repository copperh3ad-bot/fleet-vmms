// Supabase is used for sign-in only (CLAUDE.md rule 2). Tenant data never goes through this client.
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";

export async function supabaseServer() {
  const store = await cookies();
  const secure = (await headers()).get("x-forwarded-proto") === "https";
  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try { list.forEach(({ name, value, options }) => store.set(name, value, { ...options, httpOnly: true, sameSite: "lax", secure: secure || options?.secure })); }
        catch { /* called from a Server Component: the proxy refreshes the session instead */ }
      },
    },
  });
}
