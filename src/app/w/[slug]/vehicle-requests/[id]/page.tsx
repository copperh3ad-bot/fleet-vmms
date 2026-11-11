import { dmyTime as when, dmy as day } from "@/lib/format/date";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { getVehicleRequest, poolVehicles, VREQ_STATUS_LABEL } from "@/lib/vehicle-requests/service";
import { PageHeader, Panel, Pill, Plate } from "@/components/ui";
import { VehicleRequestStep } from "./steps";

export default function VehicleRequestPage({ params }: PageProps<"/w/[slug]/vehicle-requests/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}


async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug);
  const driver = getDriver();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [r, perms] = await Promise.all([getVehicleRequest(driver, m, id), permissionsOf(driver, m)]);
  if (!r) notFound();
  const assigner = (perms.has("vreq.assign") || perms.has("vreq.decide")) && r.for_user !== m.userId;     // may give a pool vehicle (A2)
  const decider = perms.has("vreq.decide") && r.for_user !== m.userId;                                      // may approve buying one, or reject
  const canCancel = (perms.has("vreq.decide") || perms.has("vreq.assign") || (r.requested_by_me && perms.has("vreq.request"))) && (r.status === "requested" || r.status === "purchase_approved");
  const pool = assigner && (r.status === "requested" || r.status === "purchase_approved") ? await poolVehicles(driver, m) : [];
  const step = { slug, id };
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader crumb={<a href={`/w/${slug}/vehicle-requests`} className="text-sky-800 hover:underline">Vehicle requests</a>} title={r.request_no} sub={r.reason} actions={<Pill>{VREQ_STATUS_LABEL[r.status] ?? r.status}</Pill>} />
      <Panel title="The request">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="text-zinc-500">For</dt><dd>{r.for_name}</dd></div>
          <div><dt className="text-zinc-500">Asked by</dt><dd>{r.requester_name}</dd></div>
          <div><dt className="text-zinc-500">Needed from</dt><dd>{day(r.needed_from)}</dd></div>
          <div><dt className="text-zinc-500">Kind of vehicle</dt><dd>{r.vehicle_class ?? "Not stated"}</dd></div>
          <div><dt className="text-zinc-500">Vehicle given</dt><dd>{r.registration_no ? <Plate>{r.registration_no}</Plate> : "Not yet"}</dd></div>
          {r.decision_note && <div><dt className="text-zinc-500">Decision note</dt><dd>{r.decision_note}</dd></div>}
        </dl>
      </Panel>

      {assigner && (r.status === "requested" || r.status === "purchase_approved") && (
        <Panel title="Give a vehicle from the pool" sub="Vehicles that are in service and that nobody holds at the moment. The employee becomes its holder.">
          {pool.length === 0 ? <p className="text-sm text-zinc-500">No vehicle is free. Approve buying one, then give it here once it has been added.</p>
            : <VehicleRequestStep {...step} to="assigned" label="Give this vehicle" fields={["vehicle", "note"]} vehicles={pool.map((v): [string, string] => [v.id, `${v.registration_no}${v.label ? " · " + v.label : ""}`])} />}
        </Panel>
      )}
      {decider && r.status === "requested" && <Panel title="Approve buying one"><VehicleRequestStep {...step} to="purchase_approved" label="Approve the purchase" fields={["note"]} /></Panel>}
      {decider && r.status === "requested" && <Panel title="Reject"><VehicleRequestStep {...step} to="rejected" label="Reject request" fields={["note"]} /></Panel>}
      {canCancel && <Panel title="Cancel"><VehicleRequestStep {...step} to="cancelled" label="Cancel request" fields={["note"]} /></Panel>}

      <Panel title="History" flush>
        <ol className="divide-y divide-zinc-100 text-sm">
          {r.events.map((e, i) => (
            <li key={i} className="flex flex-wrap gap-x-3 px-5 py-3"><span className="font-medium">{VREQ_STATUS_LABEL[e.to_status] ?? e.to_status}</span>
              <span className="text-zinc-500">{e.actor_name ?? "Someone"} · {when(e.created_at)}</span>{e.note && <span className="w-full text-zinc-700">{e.note}</span>}</li>
          ))}
        </ol>
      </Panel>
    </main>
  );
}
