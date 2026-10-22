import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { getVehicle, listEmployeeOptions } from "@/lib/master/service";
import { Card } from "@/components/form";
import { CustodyForms, StatusForm } from "./forms";

export default function VehiclePage({ params }: PageProps<"/w/[slug]/vehicles/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PM_TEXT: Record<string, string> = { overdue: "Overdue", due_soon: "Due soon", no_history: "No history", scheduled: "Booked", ok: "OK" };

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  if (!UUID.test(id)) notFound();
  const m = await requireMembership(slug);
  const driver = getDriver();
  const perms = await permissionsOf(driver, m);
  const v = await getVehicle(driver, m, id);
  if (!v) notFound();
  const canWrite = perms.has("vehicle.write");
  const employees = canWrite ? await listEmployeeOptions(driver, m) : [];
  const row = (k: string, val: string | number | null) => (
    <div className="flex justify-between gap-4 border-b border-zinc-100 py-1.5 text-sm last:border-0"><dt className="text-zinc-500">{k}</dt><dd className="text-right">{val || "—"}</dd></div>
  );
  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 p-4 text-zinc-900">
      <div><a href={`/w/${slug}/vehicles`} className="text-sm text-sky-800 underline">All vehicles</a>
        <h1 className="mt-1 text-xl font-semibold text-inherit">{v.registration_no} <span className="ml-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal capitalize">{v.status.replace("_", " ")}</span></h1></div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Details">
          <dl>
            {row("Vehicle", [v.make, v.model, v.year].filter(Boolean).join(" "))}
            {row("Class", v.vehicle_class)}{row("Fuel", v.fuel_type)}{row("Colour", v.colour)}
            {row("Chassis / VIN", v.vin)}{row("Engine number", v.engine_no)}{row("Base location", v.base_location)}
            {row("Odometer", `${Number(v.odometer_km).toLocaleString("en-US", { maximumFractionDigits: 0 })} km`)}
          </dl>
          {canWrite && <StatusForm slug={slug} vehicleId={v.id} current={v.status} />}
        </Card>
        <Card title="Preventive maintenance">
          {v.pm.length === 0 ? <p className="text-sm text-zinc-500">No service types set up.</p> : (
            <ul className="space-y-1 text-sm">
              {v.pm.map((p) => <li key={p.label} className="flex justify-between"><span>{p.label}</span><span>{PM_TEXT[p.status] ?? p.status}{p.due_on && <span className="ml-2 text-xs text-zinc-500">due {p.due_on}</span>}</span></li>)}
            </ul>
          )}
        </Card>
      </div>
      <Card title="Custody">
        <p className="mb-3 text-sm">Held by: <strong>{v.holder_name ?? "no one"}</strong></p>
        {canWrite && <CustodyForms slug={slug} vehicleId={v.id} employees={employees} hasHolder={!!v.holder_id} />}
        <table className="mt-4 w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs text-zinc-500"><tr><th className="py-2">Person</th><th>From</th><th>To</th></tr></thead>
          <tbody>
            {v.custody.length === 0 && <tr><td colSpan={3} className="py-3 text-zinc-500">No custody recorded.</td></tr>}
            {v.custody.map((c) => <tr key={c.id} className="border-b border-zinc-100 last:border-0"><td className="py-2">{c.full_name}</td><td>{c.from_date}</td><td>{c.to_date ?? <span className="text-green-700">current</span>}</td></tr>)}
          </tbody>
        </table>
      </Card>
    </main>
  );
}
