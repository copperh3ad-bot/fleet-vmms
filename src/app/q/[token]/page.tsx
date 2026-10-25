import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { DEAD_QUOTE_LINK, lookupQuoteLink } from "@/lib/vendorflow/link";
import { EstimateForm } from "./form";
import { Logo } from "@/components/brand";

export const metadata: Metadata = { title: "Send an estimate", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function EstimateLinkPage({ params }: PageProps<"/q/[token]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

// Open page: it shows only the job number, the vehicle and what is wanted (ADR-030). Not who raised it, any budget, or other workshops' prices.
async function Inner({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const view = (await allowShared(getDriver(), `quote-view-ip:${await clientIp()}`, 60, 600)) ? await lookupQuoteLink(getDriver(), token) : null;
  const car = view ? [view.make, view.model, view.year].filter(Boolean).join(" ") : "";
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-page text-zinc-900">
      <header className="bg-side px-5 py-5 text-white"><Logo height={40} /></header>
      <main className="flex flex-1 flex-col gap-5 p-5">
        {view ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold">Send your estimate</h1>
              <p className="mt-1 text-zinc-600">For {view.vendor_name}. The estimate is recorded against job card <span className="font-mono">{view.job_no}</span>.</p>
            </div>
            <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-5">
              <span className="inline-block rounded-md border-[1.5px] border-zinc-900 px-3 py-1 font-mono text-lg tracking-wider">{view.registration_no}</span>
              {car && <p className="text-zinc-700">{car}</p>}
              {(view.description || view.cause_text) && <p className="text-sm text-zinc-700">{view.description || view.cause_text}</p>}
              {view.needed_by && <p className="text-sm text-zinc-500">Needed by {new Date(view.needed_by).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}</p>}
            </div>
            <EstimateForm token={token} currency={view.currency} />
          </>
        ) : (
          <p role="status" className="rounded-xl border border-zinc-200 bg-white p-5 text-base">{DEAD_QUOTE_LINK}</p>
        )}
      </main>
    </div>
  );
}
