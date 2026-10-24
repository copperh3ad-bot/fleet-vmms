"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** One sidebar link. Highlights itself for its own page and the pages under it, minus `exclude`, plus `also`. */
export function NavLink({ href, label, badge, exact, exclude = [], also = [], onDark = true, icon }: {
  href: string; label: ReactNode; badge?: number; exact?: boolean; exclude?: string[]; also?: string[]; onDark?: boolean; icon?: ReactNode;
}) {
  const path = usePathname();
  const under = (base: string) => path === base || path.startsWith(`${base}/`);
  const active = (exact ? path === href : under(href) && !exclude.some(under)) || also.some(under);
  const tone = onDark
    ? active ? "nav-active text-white" : "text-[#C6D3DC] hover:bg-side-active/60 hover:text-white"
    : active ? "bg-sky-100 text-sky-800" : "text-zinc-700 hover:bg-zinc-100";
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={`nav-item flex h-[38px] items-center gap-2 rounded-lg px-3 text-sm font-medium ${tone}`}>
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? <span className="rounded-full bg-badge px-2 py-0.5 text-xs font-semibold leading-none text-side" aria-label={`${badge} waiting`}>{badge}</span> : null}
    </Link>
  );
}
