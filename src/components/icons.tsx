import type { ReactNode } from "react";

/** Small line icons for the public pages, drawn here so there is nothing to download. Decorative: hidden from assistive technology. */
const base = { width: 20, height: 20, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true } as const;

const PATHS: Record<string, ReactNode> = {
  approve: <><path d="M9 12l2 2 4-4" /><rect x="4" y="3" width="16" height="18" rx="2" /></>,
  workshop: <><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.4 2.4-2.6-.6-.6-2.6z" /></>,
  odometer: <><path d="M4 18a8 8 0 1 1 16 0" /><path d="M12 18l4-6" /><circle cx="12" cy="18" r="1" /></>,
  service: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  budget: <><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>,
  papers: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></>,
  shield: <><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></>,
  phone: <><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></>,
  export: <><path d="M12 3v12M7 8l5-5 5 5M5 21h14" /></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  bell: <><path d="M6 17V11a6 6 0 0 1 12 0v6l2 2H4z" /><path d="M10 21h4" /></>,
  chat: <><path d="M4 5h16v11H9l-5 4z" /><path d="M8 10h8M8 13h5" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6" /><circle cx="17" cy="9" r="2.4" /><path d="M17 14c2.6 0 4 2 4 5" /></>,
  spark: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" /><path d="M19 17v4M17 19h4" /></>,
  car: <><path d="M4 16V12l2-5h12l2 5v4z" /><path d="M4 12h16" /><circle cx="8" cy="17" r="1.6" /><circle cx="16" cy="17" r="1.6" /></>,
};

export function Icon({ name, size = 20, className }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  return <svg {...base} width={size} height={size} className={className}>{PATHS[name] ?? null}</svg>;
}
