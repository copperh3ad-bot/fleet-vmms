"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSignedIn } from "@/components/auth-links";

const LINKS: [string, string][] = [
  ["/login", "Sign in"], ["/", "Home"], ["/features", "Features"], ["/pricing", "Pricing"], ["/compare", "Compare plans"], ["/about", "About us"], ["/contact", "Contact us"],
  ["/join", "Join your company"],
];

/** The phone menu for the pages anyone can open: every public page one tap away. Closes when a link is used, when the page
 *  changes, when Escape is pressed or when the screen is touched outside it. Wider screens show the links in the bar instead. */
export function PublicMenu() {
  const path = usePathname();
  const signedIn = useSignedIn();
  const links = signedIn ? [["/", "Open workspace"] as [string, string], ...LINKS.slice(2)] : LINKS;
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(path);
  if (seen !== path) { setSeen(path); setOpen(false); }
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={box} className="relative sm:hidden">
      <button type="button" aria-expanded={open} aria-controls="public-menu" onClick={() => setOpen(!open)}
        className="flex h-10 w-10 items-center justify-center rounded-md text-[#C9D5DC] hover:text-white">
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
        <svg aria-hidden width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? <path d="M4 4l12 12M16 4L4 16" /> : <path d="M3 5h14M3 10h14M3 15h14" />}
        </svg>
      </button>
      {open && (
        <nav id="public-menu" aria-label="Site" className="absolute right-0 top-12 z-20 max-h-[calc(100dvh-5rem)] w-64 overflow-y-auto rounded-xl border border-white/10 bg-[#1c2127] p-2 shadow-2xl">
          {links.map(([href, label]) => (
            <a key={href} href={href} aria-current={path === href ? "page" : undefined}
              className={`block rounded-lg px-3 py-3 text-sm ${path === href ? "bg-white/10 font-medium text-white" : "text-[#C9D5DC] hover:bg-white/5 hover:text-white"}`}>{label}</a>
          ))}
        </nav>
      )}
    </div>
  );
}
