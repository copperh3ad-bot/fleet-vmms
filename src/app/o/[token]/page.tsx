import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { DEAD_LINK, lookupLink } from "@/lib/odometer/link";
import { ReadingForm } from "./form";
import { Logo } from "@/components/brand";

export const metadata: Metadata = { title: "Odometer reading", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function LinkPage({ params }: PageProps<"/o/[token]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const monthName = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

// Open page: it shows only the plate and the month (ADR-006), so the layout is the board's phone screen without
// the details the board adds (owner, last reading, photo), which would reveal more than a link in a message should.
async function Inner({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const view = (await allowShared(getDriver(), `link-view-ip:${await clientIp()}`, 60, 600)) ? await lookupLink(getDriver(), token) : null;
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-page text-zinc-900">
      <header className="bg-side px-5 py-5 text-white"><Logo height={40} /></header>
      <main className="flex flex-1 flex-col gap-5 p-5">
        {view ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold">Send this month&apos;s reading</h1>
              <p className="mt-1 text-zinc-600">{monthName(view.period)}</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-5">
              <span className="inline-block rounded-md border-[1.5px] border-zinc-900 px-3 py-1 font-mono text-lg tracking-wider">{view.plate}</span>
            </div>
            <ReadingForm token={token} />
          </>
        ) : (
          <p role="status" className="rounded-xl border border-zinc-200 bg-white p-5 text-base">{DEAD_LINK}</p>
        )}
      </main>
    </div>
  );
}
