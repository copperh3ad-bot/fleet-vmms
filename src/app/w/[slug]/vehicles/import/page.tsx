import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { authorized } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { VEHICLE_CSV_COLUMNS } from "@/lib/master/service";
import { ImportForm } from "./form";

export default function ImportPage({ params }: PageProps<"/w/[slug]/vehicles/import">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  await authorized(getDriver(), m, "vehicle.write", async () => {}); // same gate as the import itself
  const example = [VEHICLE_CSV_COLUMNS.join(","), "BKL-245,Isuzu,NPR,2021,truck,diesel,48200,E-001,2026-01-01,2026-09-01,47000"].join("\n");
  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold text-inherit">Import vehicles from CSV</h1>
      <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <p>First row must be the column names. Only <code>registration_no</code> is required. Up to 500 rows, 1 MB.</p>
        <p className="mt-2 text-zinc-600"><code>employee_no</code> must match an existing employee. <code>last_oil_change</code> is a date (YYYY-MM-DD) and starts the oil change clock.</p>
        <pre className="mt-3 overflow-x-auto rounded bg-zinc-100 p-3 text-xs">{example}</pre>
        <a className="mt-2 inline-block text-sky-800 underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(example + "\n")}`} download="vehicles-template.csv">Download template</a>
      </div>
      <ImportForm slug={slug} />
    </main>
  );
}
