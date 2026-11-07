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
  const m = await requireMembership(slug, { fullScope: true });
  await authorized(getDriver(), m, "vehicle.write", async () => {}); // same gate as the import itself
  const example = [VEHICLE_CSV_COLUMNS.join(","), "BKL-245,Isuzu,NPR,2021,truck,diesel,,,White,Lahore depot,48200,E-001,2026-01-01,2026-09-01,47000,Logistics"].join("\n");
  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold text-inherit">Import vehicles</h1>
      <div className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">
        <p>Fill in the <a className="text-sky-800 underline" href="/vehicle-sheet.xlsx" download>Fleet OTG vehicle sheet</a> (Excel) and upload it as it is, or use a CSV file. First row must be the column names. Only <code>registration_no</code> is required. Up to 500 rows.</p>
        <p className="mt-2 text-zinc-600"><code>employee_no</code> must match an existing employee. <code>last_oil_change</code> is a date (YYYY-MM-DD) and starts the oil change clock. <code>department</code> is optional: the operating department that runs the vehicle, for example Logistics.</p>
        <pre className="mt-3 overflow-x-auto rounded bg-zinc-100 p-3 text-xs">{example}</pre>
        <p className="mt-2 flex flex-wrap gap-x-4"><a className="text-sky-800 underline" href="/vehicle-sheet.xlsx" download>Download the Excel sheet</a><a className="text-sky-800 underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(example + "\n")}`} download="vehicles-template.csv">Download a CSV example</a></p>
      </div>
      <ImportForm slug={slug} />
    </main>
  );
}
