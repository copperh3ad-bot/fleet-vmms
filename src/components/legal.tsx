import type { ReactNode } from "react";
import { SiteShell } from "@/components/site-shell";

/** A legal page. The draft notice is deliberate and stays until the owner has replaced the text with reviewed wording. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SiteShell>
      <article className="mx-auto max-w-3xl px-5 py-12">
        <p role="note" className="mb-6 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <strong>Draft.</strong> This text is a starting point written for the product, not legal advice. Text in [square brackets] must be filled in, and the whole page should be reviewed by a lawyer before launch.
        </p>
        <h1 className="text-3xl font-semibold">{title}</h1>
        <div className="mt-6 space-y-5 text-[15px] leading-7 text-zinc-800 [&_h2]:mt-8 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-zinc-900 [&_li]:ml-5 [&_li]:list-disc">{children}</div>
      </article>
    </SiteShell>
  );
}
