import { dmy } from "@/lib/format/date";
import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { DEAD_QUOTE_LINK, lookupWorkshopLink } from "@/lib/vendorflow/link";
import { EstimateForm } from "./form";
import { sendEstimateAction, sendInvoiceAction } from "./actions";
import { InvoiceForm } from "./invoice-form";
import { Logo } from "@/components/brand";

export const metadata: Metadata = { title: "Send to the fleet office", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function EstimateLinkPage({ params }: PageProps<"/q/[token]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

// Open page: it shows only the job number, the vehicle and what is wanted (ADR-030, ADR-033). Not who raised it, any budget, or other workshops' prices.
async function Inner({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const link = (await allowShared(getDriver(), `quote-view-ip:${await clientIp()}`, 60, 600)) ? await lookupWorkshopLink(getDriver(), token) : null;
  const view = link?.view ?? null;
  const invoice = link?.kind === "invoice" ? link.view : null;
  const car = view ? [view.make, view.model, view.year].filter(Boolean).join(" ") : "";
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-page text-zinc-900">
      <header className="bg-side px-5 py-5 text-white"><Logo height={40} /></header>
      <main className="flex flex-1 flex-col gap-5 p-5">
        {view ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold">{invoice ? "Send your invoice" : "Send your estimate"}</h1>
              <p className="mt-1 text-zinc-600">For {view.vendor_name}. The {invoice ? "invoice" : "estimate"} is recorded against job card <span className="font-mono">{view.job_no}</span>.</p>
            </div>
            <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-5">
              <span className="inline-block rounded-md border-[1.5px] border-zinc-900 px-3 py-1 font-mono text-lg tracking-wider">{view.registration_no}</span>
              {car && <p className="text-zinc-700">{car}</p>}
              {(view.description || (link?.kind === "quotation" && link.view.cause_text)) && <p className="text-sm text-zinc-700">{view.description || (link?.kind === "quotation" ? link.view.cause_text : "")}</p>}
              {link?.kind === "quotation" && link.view.needed_by && <p className="text-sm text-zinc-500">Needed by {dmy(link.view.needed_by)}</p>}
              {invoice && <p className="text-sm text-zinc-500">Work order <span className="font-mono">{invoice.wo_no}</span></p>}
            </div>
            {invoice ? <InvoiceForm submit={sendInvoiceAction.bind(null, token)} currency={view.currency} approved={invoice.lines} /> : <EstimateForm submit={sendEstimateAction.bind(null, token)} currency={view.currency} />}
          </>
        ) : (
          <p role="status" className="rounded-xl border border-zinc-200 bg-white p-5 text-base">{DEAD_QUOTE_LINK}</p>
        )}
      </main>
    </div>
  );
}
