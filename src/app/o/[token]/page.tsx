import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { DEAD_LINK, lookupLink } from "@/lib/odometer/link";
import { ReadingForm } from "./form";

export const metadata: Metadata = { title: "Odometer reading", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function LinkPage({ params }: PageProps<"/o/[token]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const monthName = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

async function Inner({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const view = (await allowShared(getDriver(), `link-view-ip:${await clientIp()}`, 60, 600)) ? await lookupLink(getDriver(), token) : null;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-6 text-zinc-900">
      {view ? (
        <>
          <div>
            <p className="text-sm text-zinc-600">Odometer reading for {monthName(view.period)}</p>
            <h1 className="text-2xl font-semibold">{view.plate}</h1>
          </div>
          <ReadingForm token={token} />
          <p className="text-xs text-zinc-500">Look at the dashboard and type the number you see. This link works once.</p>
        </>
      ) : (
        <p role="status" className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">{DEAD_LINK}</p>
      )}
    </main>
  );
}
