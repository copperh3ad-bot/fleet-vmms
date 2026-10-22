import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listCycles } from "@/lib/odometer/service";
import { OpenCycleForm } from "./forms";

export default function OdometerPage({ params }: PageProps<"/w/[slug]/odometer">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const monthName = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const cycles = await listCycles(getDriver(), m);
  const next = new Date(); const defaultPeriod = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold">Odometer readings</h1>
      <section className="rounded-lg border border-zinc-200 bg-white p-4">
        <h2 className="mb-3 text-sm font-semibold">Start a month</h2>
        <OpenCycleForm slug={slug} defaultPeriod={defaultPeriod} />
      </section>
      {cycles.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600">No months started yet.</p> : (
        <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm">
          {cycles.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 p-3">
              <a className="font-medium text-sky-800 hover:underline" href={`/w/${slug}/odometer/${c.id}`}>{monthName(c.period)}</a>
              <span className={`rounded-full px-2 py-0.5 text-xs ${c.status === "open" ? "bg-sky-100 text-sky-800" : "bg-zinc-100 text-zinc-600"}`}>{c.status === "open" ? "Open" : "Closed"}</span>
              <span className="ml-auto text-zinc-600">{c.pending} waiting · {c.submitted} to review · {c.approved} done</span>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
