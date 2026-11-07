import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { listVehicleRequests, VREQ_STATUS_LABEL } from "@/lib/vehicle-requests/service";
import { PageHeader, Panel, Pill, Plate, btnPrimary, type Tone } from "@/components/ui";

export default function VehicleRequestsPage({ params, searchParams }: PageProps<"/w/[slug]/vehicle-requests">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const TONE: Record<string, Tone> = { requested: "warn", purchase_approved: "info", assigned: "ok", rejected: "bad", cancelled: "neutral" };
const day = (s: string) => new Date(s).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" });

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "";
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [rows, perms] = await Promise.all([listVehicleRequests(driver, m, { status: status || undefined }), permissionsOf(driver, m)]);
  const waiting = perms.has("vreq.decide") ? rows.filter((r) => r.status === "requested") : [];
  const control = "h-10 rounded-md border border-zinc-300 bg-white px-3 text-sm";
  const table = (list: typeof rows) => (
    <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead className="text-[11px] uppercase tracking-wide text-zinc-500">
        <tr><th className="px-5 py-3">Request</th><th>For</th><th>Why</th><th>Needed from</th><th>Vehicle</th><th className="px-5">Status</th></tr>
      </thead>
      <tbody>
        {list.map((r) => (
          <tr key={r.id} className="border-t border-zinc-100">
            <td className="px-5 py-3 font-medium"><a className="text-sky-800 hover:underline" href={`/w/${slug}/vehicle-requests/${r.id}`}>{r.request_no}</a><span className="block text-xs font-normal text-zinc-500">Asked by {r.requester_name}</span></td>
            <td className="py-3">{r.for_name}</td>
            <td className="py-3">{r.reason}{r.vehicle_class && <span className="block text-xs text-zinc-500">{r.vehicle_class}</span>}</td>
            <td className="py-3">{day(r.needed_from)}</td>
            <td className="py-3">{r.registration_no ? <Plate>{r.registration_no}</Plate> : "—"}</td>
            <td className="px-5 py-3"><Pill tone={TONE[r.status] ?? "neutral"}>{VREQ_STATUS_LABEL[r.status] ?? r.status}</Pill></td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Vehicle requests" sub={`${rows.length} shown`} actions={perms.has("vreq.request") ? <a href={`/w/${slug}/vehicle-requests/new`} className={btnPrimary}>Ask for a vehicle</a> : undefined} />
      {waiting.length > 0 && <Panel title="Waiting for your decision" sub={`${waiting.length} request${waiting.length === 1 ? "" : "s"}`} flush>{table(waiting)}</Panel>}
      <form className="flex flex-wrap gap-2" role="search">
        <select name="status" defaultValue={status} className={control} aria-label="Status">
          <option value="">Any status</option>
          {Object.entries(VREQ_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <button className={`${control} font-medium hover:bg-zinc-50`}>Filter</button>
      </form>
      <Panel flush>{rows.length === 0 ? <p className="p-5 text-sm text-zinc-500">No vehicle requests yet.</p> : table(rows)}</Panel>
    </main>
  );
}
