import type { ReactNode } from "react";

/** The dark band at the top of a public inner page, in the same look as the landing page's hero. Server component, no motion. */
export function PageHero({ eyebrow, title, children }: { eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <section className="hero-bg relative overflow-hidden text-white">
      <div className="mx-auto max-w-6xl 2xl:max-w-[96rem] px-5 py-12 md:py-16">
        <p className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-xs text-[#C9D5DC]"><span aria-hidden className="h-1.5 w-1.5 rounded-full bg-badge" /> {eyebrow}</p>
        <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight md:text-4xl">{title}</h1>
        {children && <div className="mt-4 max-w-3xl text-lg text-[#C9D5DC]">{children}</div>}
      </div>
    </section>
  );
}

/** The closing dark band with one main action, shared by the inner pages. */
export function CtaBand({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="hero-bg relative overflow-hidden text-white" aria-label="Get started">
      <div className="mx-auto flex max-w-6xl 2xl:max-w-[96rem] flex-wrap items-center justify-between gap-6 px-5 py-12">
        <h2 className="max-w-xl text-2xl font-semibold">{title}</h2>
        <div className="flex flex-wrap items-center gap-4">{children}</div>
      </div>
    </section>
  );
}
