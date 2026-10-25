import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listCycles } from "@/lib/odometer/service";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { OpenCycleForm } from "./forms";

export default function OdometerPage({ params }: PageProps<"/w/[slug]/odometer">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const monthName = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug, { fullScope: true });
  const cycles = await listCycles(getDriver(), m);
  const next = new Date(); const defaultPeriod = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Odometer readings" sub="One month at a time: send each driver a link, then review what comes back" />
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel title="Months" flush>
          {cycles.length === 0 ? <p className="p-5 text-sm text-zinc-500">No months started yet.</p> : (
            <ul className="divide-y divide-zinc-100 text-sm">
              {cycles.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <a className="font-medium text-sky-800 hover:underline" href={`/w/${slug}/odometer/${c.id}`}>{monthName(c.period)}</a>
                  <Pill tone={c.status === "open" ? "info" : "neutral"}>{c.status === "open" ? "Open" : "Closed"}</Pill>
                  <span className="ml-auto text-zinc-600">{c.pending} waiting · {c.submitted} to review · {c.approved} done</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Start a month"><OpenCycleForm slug={slug} defaultPeriod={defaultPeriod} /></Panel>
      </div>
    </main>
  );
}
