"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { countdown } from "@/lib/billing/countdown";

const TONE = { info: "border-sky-200 bg-sky-100 text-sky-900", warn: "border-amber-200 bg-amber-50 text-amber-900", bad: "border-red-200 bg-red-50 text-red-900" } as const;

/**
 * The banner while a free trial runs: a live countdown to the moment it ends. `msLeft` is measured by the server when the page was made; the browser counts down
 * from there, so the customer's own clock does not matter. Until the browser has started counting (and for anyone without scripts) the plain line the server
 * wrote is shown. When it reaches zero the page is refreshed once, so the workspace shows its locked state at once.
 */
export function TrialCountdown({ slug, msLeft, fallback }: { slug: string; msLeft: number; fallback: string }) {
  const router = useRouter();
  const target = useRef<number | null>(null);
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    target.current = performance.now() + msLeft;      // a monotonic clock: it does not jump if the device's date is changed
    const tick = () => {
      const l = Math.max(0, target.current! - performance.now());
      setLeft(l);
      if (l === 0) { clearInterval(id); router.refresh(); }
    };
    const id = setInterval(tick, 1000);
    const first = setTimeout(tick, 0);                // the first reading, as soon as the page is shown
    return () => { clearInterval(id); clearTimeout(first); };
  }, [msLeft, router]);

  const c = left === null ? null : countdown(left);
  return (
    <p className={`mx-6 mt-4 flex flex-wrap items-center gap-x-3 rounded-md border px-4 py-2.5 text-sm ${TONE[c?.tone ?? "info"]}`}>
      {c ? (
        <>
          <span aria-hidden>Free trial ends in <strong className="font-mono tabular-nums">{c.text}</strong></span>
          <span role="status" className="sr-only">{c.spoken}</span>
        </>
      ) : <span role="status">{fallback}</span>}
      <a href={`/w/${slug}/billing`} className="font-medium underline">Subscribe</a>
    </p>
  );
}
