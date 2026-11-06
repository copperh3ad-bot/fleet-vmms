import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { listPoolCandidates, listTrips, tripsEnabled, TRIP_STATUS_LABEL } from "@/lib/trips/service";
import { PoolSwitch } from "./pool-switch";
import { PageHeader, Panel, Pill, Plate, btnPrimary, type Tone } from "@/components/ui";

export default function TripsPage({ params, searchParams }: PageProps<"/w/[slug]/trips">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const TONE: Record<string, Tone> = { requested: "warn", approved: "info", started: "info", completed: "ok", rejected: "bad", cancelled: "neutral" };
const when = (s: string) => new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "";
  const m = await requireMembership(slug);
  const driver = getDriver();
  if (!(await tripsEnabled(driver, m))) return <main className="p-6 text-sm text-zinc-600">Trips are not switched on for this organization. An administrator can switch them on in Settings.</main>;
  const [rows, perms] = await Promise.all([listTrips(driver, m, { status: status || undefined }), permissionsOf(driver, m)]);
  const dispatcher = perms.has("trip.dispatch");
  const waiting = perms.has("trip.approve") ? rows.filter((r) => r.status === "requested") : dispatcher ? rows.filter((r) => r.status === "requested" && r.dispatchable) : [];
  const pool = dispatcher || perms.has("vehicle.write") ? await listPoolCandidates(driver, m) : [];
  const control = "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm";
  const table = (list: typeof rows) => (
    <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead className="text-[11px] uppercase tracking-wide text-zinc-500">
        <tr><th className="px-5 py-3">Trip</th><th>Purpose</th><th>Route</th><th>Leaves</th><th>Vehicle</th><th>Driver</th><th className="px-5">Status</th></tr>
      </thead>
      <tbody>
        {list.map((r) => (
          <tr key={r.id} className="border-t border-zinc-100">
            <td className="px-5 py-3 font-medium"><a className="text-sky-800 hover:underline" href={`/w/${slug}/trips/${r.id}`}>{r.trip_no}</a>{r.kind === "pick_drop" && <span className="block text-xs font-normal text-zinc-500">Pick and drop</span>}</td>
            <td className="py-3">{r.purpose}<span className="block text-xs text-zinc-500">{r.requester_name}</span></td>
            <td className="py-3">{r.from_place} → {r.to_place}</td>
            <td className="py-3">{when(r.start_at)}</td>
            <td className="py-3">{r.registration_no ? <Plate>{r.registration_no}</Plate> : "—"}</td>
            <td className="py-3">{r.driver_name ?? "—"}</td>
            <td className="px-5 py-3"><Pill tone={TONE[r.status] ?? "neutral"}>{TRIP_STATUS_LABEL[r.status] ?? r.status}</Pill></td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Trips" sub={`${rows.length} shown`} actions={perms.has("trip.request") ? <a href={`/w/${slug}/trips/new`} className={btnPrimary}>Ask for a trip</a> : undefined} />
      {waiting.length > 0 && <Panel title="Waiting for your approval" sub={`${waiting.length} request${waiting.length === 1 ? "" : "s"}`} flush>{table(waiting)}</Panel>}
      <form className="flex flex-wrap gap-2" role="search">
        <select name="status" defaultValue={status} className={control} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(TRIP_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className={`${control} font-medium hover:bg-zinc-50`}>Filter</button>
      </form>
      {pool.length > 0 && (
        <Panel title="Pool cars" sub="Cars the logistics team runs for staff pick and drop. Pick and drop requests can only be given one of these.">
          <ul className="divide-y divide-zinc-100 text-sm">{pool.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-2"><Plate>{c.registration_no}</Plate><span className="text-zinc-600">{c.label}</span>
              {c.status !== "active" && <Pill tone="warn">{c.status.replace("_", " ")}</Pill>}<span className="ml-auto"><PoolSwitch slug={slug} id={c.id} pool={c.is_pool} /></span></li>
          ))}</ul>
        </Panel>
      )}
      <Panel flush>{rows.length === 0 ? <p className="p-5 text-sm text-zinc-500">No trips yet.</p> : table(rows)}</Panel>
    </main>
  );
}
