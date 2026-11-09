import { dmy, dmyTime } from "@/lib/format/date";
import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { DEAD_QUOTE_LINK, lookupWorkshopLink } from "@/lib/vendorflow/link";
import { EstimateForm } from "./form";
import { sendEstimateAction, sendInvoiceAction, sendTripInvoiceAction, sendTripQuoteAction } from "./actions";
import { TripInvoiceForm, TripQuoteForm } from "./trip-form";
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
  const found = (await allowShared(getDriver(), `quote-view-ip:${await clientIp()}`, 60, 600)) ? await lookupWorkshopLink(getDriver(), token) : null;
  if (found?.kind === "trip_quote") return <TripQuotePage token={token} view={found.view} />;
  if (found?.kind === "trip_invoice") return <TripInvoicePage token={token} view={found.view} />;
  const link = found as Exclude<typeof found, { kind: "trip_quote" | "trip_invoice" }>;
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

/** A logistics provider's quote for one trip (ADR-078). Open page: the trip and what is to be moved, nothing about who asked or what other providers quoted. */
function TripQuotePage({ token, view }: { token: string; view: import("@/lib/vendorflow/link").TripQuoteLinkView }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-page text-zinc-900">
      <header className="bg-side px-5 py-5 text-white"><Logo height={40} /></header>
      <main className="flex flex-1 flex-col gap-5 p-5">
        <div>
          <h1 className="text-2xl font-semibold">Send your quote</h1>
          <p className="mt-1 text-zinc-600">For {view.vendor_name}. The quote is recorded against trip <span className="font-mono">{view.trip_no}</span>.</p>
        </div>
        <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-lg font-medium">{view.from_place} → {view.to_place}</p>
          <p className="text-sm text-zinc-700">{view.purpose}</p>
          {view.stops && <p className="text-sm text-zinc-700">Other stops: {view.stops}</p>}
          <p className="text-sm text-zinc-500">Leaves {dmyTime(view.start_at)} · returns {dmyTime(view.end_at)}</p>
          {view.passengers !== null && <p className="text-sm text-zinc-500">{view.passengers} passenger{view.passengers === 1 ? "" : "s"}</p>}
        </div>
        <TripQuoteForm submit={sendTripQuoteAction.bind(null, token)} currency={view.currency} />
      </main>
    </div>
  );
}

/** A logistics provider's invoice for one awarded, completed trip (ADR-078). Open page: the trip and the amount awarded, nothing about who asked or other providers. */
function TripInvoicePage({ token, view }: { token: string; view: import("@/lib/vendorflow/link").TripInvoiceLinkView }) {
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-page text-zinc-900">
      <header className="bg-side px-5 py-5 text-white"><Logo height={40} /></header>
      <main className="flex flex-1 flex-col gap-5 p-5">
        <div>
          <h1 className="text-2xl font-semibold">Send your invoice</h1>
          <p className="mt-1 text-zinc-600">For {view.vendor_name}. The invoice is recorded against trip <span className="font-mono">{view.trip_no}</span>.</p>
        </div>
        <div className="space-y-2 rounded-xl border border-zinc-200 bg-white p-5">
          <p className="text-lg font-medium">{view.from_place} → {view.to_place}</p>
          <p className="text-sm text-zinc-700">{view.purpose}</p>
          <p className="text-sm text-zinc-500">{dmyTime(view.start_at)} to {dmyTime(view.end_at)}</p>
          <p className="text-sm text-zinc-700">Agreed price: <span className="font-mono">{view.currency} {Number(view.award_amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span></p>
        </div>
        <TripInvoiceForm submit={sendTripInvoiceAction.bind(null, token)} currency={view.currency} agreed={view.award_amount} />
      </main>
    </div>
  );
}
