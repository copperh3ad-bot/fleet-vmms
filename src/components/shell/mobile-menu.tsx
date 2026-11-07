"use client";
import { useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";

/** The phone and tablet menu: folded away until opened, and folded again as soon as a link in it is used. The layout stays
 *  mounted while pages change, so a plain <details> would stay open over the new page. */
export function MobileMenu({ bar, children }: { bar: ReactNode; children: ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(path);
  if (seen !== path) { setSeen(path); setOpen(false); }
  return (
    <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">{bar}</summary>
      {/* a link to the page you are already on does not change the path, so close on the click too */}
      <div className="max-h-[calc(100dvh-4.5rem)] space-y-4 overflow-y-auto px-3 pb-4" onClick={(e) => { if ((e.target as HTMLElement).closest("a")) setOpen(false); }}>{children}</div>
    </details>
  );
}
