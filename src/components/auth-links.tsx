"use client";
import Link from "next/link";
import { useSyncExternalStore } from "react";

// Whether someone is signed in, from the readable flag cookie the proxy keeps (src/lib/supabase/proxy.ts). The public pages are
// built ahead of time and cannot know who is looking, so the buttons that depend on it are chosen here, in the browser. The
// server always renders the signed-out buttons; a signed-in visitor sees them swap a moment after the page loads.
const FLAG = /(?:^|;\s*)fleetotg_in=1(?:;|$)/;
const never = () => () => {};
export function useSignedIn(): boolean {
  return useSyncExternalStore(never, () => FLAG.test(document.cookie), () => false);
}

type Active = "signup" | "login" | "pricing" | "join" | "about" | "contact" | "features" | undefined;

/** The two buttons at the right of the public header. */
export function HeaderAuth({ active }: { active: Active }) {
  if (useSignedIn()) return <Link href="/" prefetch={false} className="rounded-md bg-badge px-4 py-2 font-medium text-side hover:opacity-90">Open workspace</Link>;
  return (
    <>
      <a href="/login" aria-current={active === "login" ? "page" : undefined}
        className={`hidden rounded-md px-3 py-2 sm:inline-block ${active === "login" ? "bg-white/10 text-white" : "text-[#C9D5DC] hover:text-white"}`}>Sign in</a>
      {active !== "signup" && <a href="/signup" className="rounded-md bg-badge px-3 py-2 font-medium text-side hover:opacity-90 sm:px-4"><span className="sm:hidden">Free trial</span><span className="hidden sm:inline">Start free trial</span></a>}
    </>
  );
}
