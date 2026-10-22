import { Suspense } from "react";
import { ExportLink } from "@/components/export-link";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { listVehicles } from "@/lib/master/service";
import { planUsage } from "@/lib/admin/service";

const PM_LABEL: Record<string, { text: string; cls: string }> = {
  overdue: { text: "Service overdue", cls: "bg-red-100 text-red-800" },
  due_soon: { text: "Service due soon", cls: "bg-amber-100 text-amber-800" },
  no_history: { text: "No service history", cls: "bg-zinc-100 text-zinc-700" },
  scheduled: { text: "Service booked", cls: "bg-sky-100 text-sky-800" },
  ok: { text: "Service OK", cls: "bg-green-100 text-green-800" },
};

export default function VehiclesPage({ params, searchParams }: PageProps<"/w/[slug]/vehicles">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Vehicles params={params} searchParams={searchParams} /></Suspense>;
}

async function Vehicles({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 80) : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [rows, perms, plan] = await Promise.all([listVehicles(driver, m, { search: q || undefined, status: status || undefined }), permissionsOf(driver, m), planUsage(driver, m)]);
  const canWrite = perms.has("vehicle.write");
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 p-4 text-zinc-900">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold text-inherit">Vehicles <span className="text-sm font-normal text-zinc-500">{rows.length}</span></h1>
        {plan.vehicles.limit !== null && <span className={`text-sm ${plan.vehicles.used >= plan.vehicles.limit ? "font-medium text-red-800" : "text-zinc-600"}`}>{plan.vehicles.used} of {plan.vehicles.limit} allowed by your plan</span>}
        {canWrite && (
          <div className="ml-auto flex gap-2 text-sm">
            <a href={`/w/${slug}/vehicles/import`} className="rounded-md border border-zinc-300 bg-white px-3 py-2">Import CSV</a>
            <a href={`/w/${slug}/vehicles/new`} className="rounded-md bg-sky-800 px-3 py-2 text-white">Add a vehicle</a>
          </div>
        )}
      </div>
      <form className="flex flex-wrap gap-2" role="search">
        <input name="q" defaultValue={q} placeholder="Search plate, make, model or holder" className="h-10 min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-3" aria-label="Search vehicles" />
        <select name="status" defaultValue={status} className="h-10 rounded-md border border-zinc-300 bg-white px-2" aria-label="Status">
          <option value="">Any status</option>
          {["active", "in_workshop", "inactive", "disposed"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}
        </select>
        <button className="h-10 rounded-md border border-zinc-300 bg-white px-4">Search</button>
      </form>
      <div className="flex justify-end"><ExportLink slug={slug} kind="vehicles" query={{ q, status }} /></div>
      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600">
          {q || status ? "No vehicle matches." : "No vehicles yet."} {canWrite && !q && !status && <>Start with <a className="text-sky-800 underline" href={`/w/${slug}/vehicles/new`}>Add a vehicle</a> or <a className="text-sky-800 underline" href={`/w/${slug}/vehicles/import`}>import a CSV</a>.</>}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500">
              <tr><th className="p-3">Registration</th><th className="p-3">Vehicle</th><th className="p-3">Held by</th><th className="p-3 text-right">Odometer km</th><th className="p-3">Service</th><th className="p-3">Status</th></tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const pm = v.pm_worst ? PM_LABEL[v.pm_worst] : null;
                return (
                  <tr key={v.id} className="border-b border-zinc-100 last:border-0">
                    <td className="p-3 font-medium"><a className="text-sky-800 hover:underline" href={`/w/${slug}/vehicles/${v.id}`}>{v.registration_no}</a></td>
                    <td className="p-3">{[v.make, v.model, v.year].filter(Boolean).join(" ") || "—"}{v.vehicle_class && <span className="ml-1 text-xs text-zinc-500">{v.vehicle_class}</span>}</td>
                    <td className="p-3">{v.holder_name ?? <span className="text-zinc-400">Unassigned</span>}</td>
                    <td className="p-3 text-right tabular-nums">{Number(v.odometer_km).toLocaleString("en-US", { maximumFractionDigits: 0 })}</td>
                    <td className="p-3">{pm && <span className={`rounded-full px-2 py-0.5 text-xs ${pm.cls}`}>{pm.text}</span>}</td>
                    <td className="p-3 capitalize">{v.status.replace("_", " ")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
