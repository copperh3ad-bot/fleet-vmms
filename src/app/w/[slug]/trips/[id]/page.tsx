import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { assignables, getTrip, tripsEnabled, TRIP_STATUS_LABEL } from "@/lib/trips/service";
import { PageHeader, Panel, Pill, Plate } from "@/components/ui";
import { TripStep } from "./steps";

export default function TripPage({ params }: PageProps<"/w/[slug]/trips/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const when = (s: string) => new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug);
  const driver = getDriver();
  if (!(await tripsEnabled(driver, m))) return <main className="p-6 text-sm text-zinc-600">Trips are not switched on for this organization.</main>;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [t, perms] = await Promise.all([getTrip(driver, m, id), permissionsOf(driver, m)]);
  if (!t) notFound();
  const approver = perms.has("trip.approve") || (t.kind === "pick_drop" && perms.has("trip.dispatch"));
  const canCancel = approver || (t.requested_by_me && perms.has("trip.request"));
  const lists = approver && t.status === "requested" ? await assignables(driver, m, { poolOnly: t.kind === "pick_drop" }) : null;
  const step = { slug, id };
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader crumb={<a href={`/w/${slug}/trips`} className="text-sky-800 hover:underline">Trips</a>} title={t.trip_no} sub={`${t.kind === "pick_drop" ? "Staff pick and drop · " : ""}${t.purpose}`} actions={<Pill>{TRIP_STATUS_LABEL[t.status] ?? t.status}</Pill>} />
      <Panel title="The trip">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="text-zinc-500">Asked by</dt><dd>{t.requester_name}</dd></div>
          <div><dt className="text-zinc-500">Route</dt><dd>{t.from_place} → {t.to_place}</dd></div>
          <div><dt className="text-zinc-500">Leaves</dt><dd>{when(t.start_at)}</dd></div>
          <div><dt className="text-zinc-500">Returns</dt><dd>{when(t.end_at)}</dd></div>
          {t.stops && <div><dt className="text-zinc-500">Other stops</dt><dd>{t.stops}</dd></div>}
          <div><dt className="text-zinc-500">Passengers</dt><dd>{t.passengers ?? "—"}</dd></div>
          <div><dt className="text-zinc-500">Preferred vehicle</dt><dd>{t.preferred_vehicle ?? "No preference"}</dd></div>
          <div><dt className="text-zinc-500">Vehicle</dt><dd>{t.registration_no ? <Plate>{t.registration_no}</Plate> : "Not assigned yet"}</dd></div>
          <div><dt className="text-zinc-500">Driver</dt><dd>{t.driver_name ?? "Not assigned yet"}</dd></div>
          <div><dt className="text-zinc-500">Odometer out / back</dt><dd>{t.odometer_out ?? "—"} / {t.odometer_in ?? "—"}{t.distance_km ? ` · ${Number(t.distance_km).toLocaleString("en-US")} km` : ""}</dd></div>
          {t.decision_note && <div><dt className="text-zinc-500">Decision note</dt><dd>{t.decision_note}</dd></div>}
        </dl>
        {t.driver_licence_expired && <p className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-amber-900">This driver&apos;s licence expires before the trip ends. Check it before they drive.</p>}
      </Panel>

      {t.status === "requested" && approver && lists && (
        <Panel title="Approve and assign">
          <TripStep {...step} to="approved" label="Approve trip" fields={["assign", "note"]}
            vehicles={lists.vehicles.map((v): [string, string] => [v.id, `${v.registration_no}${v.label ? " · " + v.label : ""}`])}
            drivers={lists.drivers.map((d): [string, string] => [d.id, d.full_name])} />
        </Panel>
      )}
      {t.status === "requested" && approver && <Panel title="Reject"><TripStep {...step} to="rejected" label="Reject trip" fields={["note"]} /></Panel>}
      {t.status === "approved" && (approver || t.mine) && <Panel title="Departure"><TripStep {...step} to="started" label="Mark as left" fields={["odometer"]} /></Panel>}
      {t.status === "started" && (approver || t.mine) && <Panel title="Return"><TripStep {...step} to="completed" label="Mark as returned" fields={["odometer"]} /></Panel>}
      {(t.status === "requested" || t.status === "approved") && canCancel && <Panel title="Cancel"><TripStep {...step} to="cancelled" label="Cancel trip" fields={["note"]} /></Panel>}

      <Panel title="History" flush>
        <ol className="divide-y divide-zinc-100 text-sm">
          {t.events.map((e, i) => (
            <li key={i} className="flex flex-wrap gap-x-3 px-5 py-3"><span className="font-medium">{TRIP_STATUS_LABEL[e.to_status] ?? e.to_status}</span>
              <span className="text-zinc-500">{e.actor_name ?? "Someone"} · {when(e.created_at)}</span>{e.note && <span className="w-full text-zinc-700">{e.note}</span>}</li>
          ))}
        </ol>
      </Panel>
    </main>
  );
}
