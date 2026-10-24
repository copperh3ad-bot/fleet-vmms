import type { ReactNode } from "react";
import Link from "next/link";

// The frame for the pages anyone can open (landing, sign-up, legal): a header with the two ways in, and a footer.
export function SiteShell({ children, active }: { children: ReactNode; active?: "signup" | "login" | "pricing" | "join" }) {
  return (
    <div className="flex min-h-screen flex-col bg-page text-zinc-900">
      <header className="bg-side text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-4">
          <Link href="/" className="text-lg font-semibold">Fleet VMMS</Link>
          <nav className="ml-auto flex items-center gap-2 text-sm" aria-label="Account">
            {active !== "pricing" && <a href="/pricing" className="rounded-md px-3 py-2 text-[#C9D5DC] hover:text-white">Pricing</a>}
            {active !== "login" && <a href="/login" className="rounded-md px-3 py-2 text-[#C9D5DC] hover:text-white">Sign in</a>}
            {active !== "signup" && <a href="/signup" className="rounded-md bg-badge px-4 py-2 font-medium text-side hover:opacity-90">Start free trial</a>}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 text-sm text-zinc-500">
          <span>Fleet VMMS</span>
          <a href="/terms" className="underline">Terms</a>
          <a href="/privacy" className="underline">Privacy</a>
          <a href="/pricing" className="underline">Pricing</a>
          <a href="/join" className="underline">Join your company</a>
          <a href="/login" className="ml-auto underline">Sign in</a>
        </div>
      </footer>
    </div>
  );
}
