import type { ReactNode } from "react";
import Link from "next/link";
import { Logo } from "@/components/brand";
import { HeaderAuth } from "@/components/auth-links";
import { PublicMenu } from "@/components/public-menu";
import { OPERATOR_NAME } from "@/lib/site";

type Page = "signup" | "login" | "pricing" | "join" | "about" | "contact" | "features";

const FOOTER: { title: string; links: [string, string][] }[] = [
  { title: "Fleet OTG", links: [["/features", "Features"], ["/pricing", "Pricing"], ["/about", "About us"], ["/contact", "Contact us"]] },
  { title: "Get started", links: [["/signup", "Start a free trial"], ["/login", "Sign in"], ["/join", "Join your company"]] },
  { title: "Legal", links: [["/terms", "Terms"], ["/privacy", "Privacy"]] },
];

// The frame for the pages anyone can open (landing, sign-up, legal): a header with the ways in, and a footer that lists every
// public page. `active` marks the page you are on. Below 640px the page links fold into a menu button.
export function SiteShell({ children, active }: { children: ReactNode; active?: Page }) {
  const item = (page: Page, href: string, label: string) => (
    <a href={href} aria-current={active === page ? "page" : undefined}
      className={`hidden rounded-md px-3 py-2 sm:inline-block ${active === page ? "bg-white/10 text-white" : "text-[#C9D5DC] hover:text-white"}`}>{label}</a>
  );
  return (
    <div className="flex min-h-dvh flex-col bg-page text-zinc-900">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-30 focus:rounded-md focus:bg-white focus:px-3 focus:py-2 focus:text-zinc-900">Skip to the page</a>
      <header className="bg-side text-white">
        <div className="mx-auto flex max-w-6xl 2xl:max-w-[96rem] items-center gap-2 px-3 py-4 min-[360px]:gap-4 min-[360px]:px-5">
          <Link href="/" prefetch={false} aria-label="Fleet OTG home" className="shrink-0"><Logo height={40} /></Link>
          <nav className="ml-auto flex items-center gap-1 whitespace-nowrap text-sm sm:gap-2" aria-label="Account">
            {item("features", "/features", "Features")}
            {item("about", "/about", "About")}
            {item("contact", "/contact", "Contact")}
            {item("pricing", "/pricing", "Pricing")}
            <HeaderAuth active={active} />
            <PublicMenu />
          </nav>
        </div>
        <div aria-hidden className="hazard-bar" />
      </header>
      <main id="content" className="flex-1">{children}</main>
      <footer className="border-t border-zinc-200 bg-white">
        <div className="mx-auto grid max-w-6xl 2xl:max-w-[96rem] gap-8 px-5 py-8 text-sm sm:grid-cols-3">
          {FOOTER.map((g) => (
            <nav key={g.title} aria-label={g.title}>
              <p className="font-semibold text-zinc-900">{g.title}</p>
              <ul className="mt-2 space-y-1 text-zinc-600">
                {g.links.map(([href, label]) => <li key={href}><a href={href} className="inline-block py-2 underline hover:text-zinc-900">{label}</a></li>)}
              </ul>
            </nav>
          ))}
        </div>
        <p className="mx-auto max-w-6xl 2xl:max-w-[96rem] border-t border-zinc-100 px-5 py-4 text-sm text-zinc-600">&copy; {OPERATOR_NAME}. Fleet OTG is operated by {OPERATOR_NAME}.</p>
      </footer>
    </div>
  );
}
