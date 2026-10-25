import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand";

// The frame for the pages anyone can open (landing, sign-up, legal): a header with the two ways in, and a footer.
export function SiteShell({ children, active }: { children: ReactNode; active?: "signup" | "login" | "pricing" | "join" | "about" | "contact" }) {
  return (
    <div className="flex min-h-screen flex-col bg-page text-zinc-900">
      <header className="bg-side text-white">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-5 py-4">
          <Link href="/" aria-label="Fleet OTG home" className="shrink-0"><Logo height={40} /></Link>
          <nav className="ml-auto flex items-center gap-1 whitespace-nowrap text-sm sm:gap-2" aria-label="Account">
            {active !== "about" && <a href="/about" className="hidden rounded-md px-3 py-2 sm:inline-block text-[#C9D5DC] hover:text-white">About</a>}
            {active !== "contact" && <a href="/contact" className="hidden rounded-md px-3 py-2 sm:inline-block text-[#C9D5DC] hover:text-white">Contact</a>}
            {active !== "pricing" && <a href="/pricing" className="hidden rounded-md px-3 py-2 min-[420px]:inline-block text-[#C9D5DC] hover:text-white">Pricing</a>}
            {active !== "login" && <a href="/login" className="rounded-md px-3 py-2 text-[#C9D5DC] hover:text-white">Sign in</a>}
            {active !== "signup" && <a href="/signup" className="rounded-md bg-badge px-4 py-2 font-medium text-side hover:opacity-90"><span className="sm:hidden">Free trial</span><span className="hidden sm:inline">Start free trial</span></a>}
          </nav>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-1 px-5 py-4 text-sm text-zinc-500 [&_a]:inline-block [&_a]:py-2">
          <span>Fleet OTG</span>
          <a href="/about" className="underline">About us</a>
          <a href="/contact" className="underline">Contact</a>
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
