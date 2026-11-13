import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { fleetOpsOn, FLEET_OPS_MESSAGE } from "@/lib/billing/fleet-ops";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { CARGO_STATUS_LABEL, getCargo, HANDLING } from "@/lib/cargo/service";
import { dmyTime } from "@/lib/format/date";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { suggestVehicles } from "@/lib/cargo/suggest";
import { CargoStep, MakeTrip, WeightForm } from "./steps";

export default function CargoDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug);
  if (!(await fleetOpsOn(getDriver(), m.tenantId))) return <main className="p-6 text-sm text-zinc-600">{FLEET_OPS_MESSAGE}</main>;
  const driver = getDriver();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [c, perms] = await Promise.all([getCargo(driver, m, id), permissionsOf(driver, m)]);
  if (!c) notFound();
  const handler = perms.has("cargo.handle");
  const suggest = handler && (c.status === "requested" || c.status === "accepted") && !c.trip_id ? await suggestVehicles(driver, m, id) : null;
  const step = { slug, id };
  const dl = (k: string, v: React.ReactNode) => <div><dt className="text-zinc-500">{k}</dt><dd>{v}</dd></div>;
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader crumb={<a href={`/w/${slug}/cargo`} className="text-sky-800 hover:underline">Cargo</a>} title={c.cargo_no} sub={c.description} actions={<Pill>{CARGO_STATUS_LABEL[c.status] ?? c.status}</Pill>} />
      <Panel title="The request">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          {dl("Asked by", <>{c.requester_name}{c.source === "whatsapp" && <span className="ml-2 text-xs text-zinc-500">by WhatsApp</span>}</>)}
          {dl("Requested on", dmyTime(c.created_at))}{c.department && dl("Requesting department", c.department)}
          {dl("Vehicle required", dmyTime(c.pickup_at))}{c.vehicle_type && dl("Vehicle type", c.vehicle_type)}
          {dl("Pick-up location (from)", c.pickup_place)}{dl("Destination (to)", c.drop_place)}
          {dl("Inventory / material load", c.description)}{dl("Quantity of load", c.quantity_text)}{c.weight_kg && dl("Weight", `${Number(c.weight_kg).toLocaleString("en-US")} kg`)}{c.volume_m3 && dl("Volume", `${Number(c.volume_m3).toLocaleString("en-US")} m³`)}
          {c.poc_details && dl("Person to contact", c.poc_details)}
          {c.pickup_contact && dl("Pick-up contact", [c.pickup_contact, c.pickup_phone].filter(Boolean).join(", "))}{c.drop_contact && dl("Delivery contact", [c.drop_contact, c.drop_phone].filter(Boolean).join(", "))}
          {c.deliver_by && dl("Deliver by", dmyTime(c.deliver_by))}
          {c.instructions && dl("Special instructions", c.instructions)}
          {c.handling && dl("Special handling", HANDLING[c.handling] ?? c.handling)}
          {c.decision_note && dl("Note", c.decision_note)}
          {c.trip_id && dl("Trip", <a className="text-sky-800 hover:underline" href={`/w/${slug}/trips/${c.trip_id}`}>{c.trip_no}</a>)}
        </dl>
      </Panel>

      {handler && c.status === "requested" && <Panel title="Accept"><CargoStep {...step} to="accepted" label="Accept the request" needsNote={false} /></Panel>}
      {handler && c.status === "requested" && <Panel title="Reject"><CargoStep {...step} to="rejected" label="Reject the request" needsNote /></Panel>}
      {suggest && (
        <Panel title="Which vehicle?" sub="Suggested from the load, the time needed and where each vehicle is. Nothing is assigned until you choose; a manager then approves the trip and assigns the driver.">
          <div className="space-y-4 text-sm">
            <WeightForm {...step} current={c.weight_kg} />
            {suggest.message && <p role="status" className="rounded-md bg-amber-50 p-3 text-amber-900">{suggest.message}</p>}
            {suggest.suggestions.length > 0 && (
              <ol className="space-y-3">
                {suggest.suggestions.slice(0, 5).map((s, i) => (
                  <li key={s.vehicle_id} className="rounded-md border border-zinc-200 p-3">
                    <p className="font-medium"><span className="font-mono">{s.registration_no}</span> {s.label}{i === 0 && <span className="ml-2 rounded bg-green-100 px-1.5 py-0.5 text-xs font-normal text-green-800">Best fit</span>}</p>
                    <ul className="mt-1 list-disc pl-5 text-zinc-700">{s.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
                    <div className="mt-2">{c.status === "accepted" ? <MakeTrip {...step} vehicleId={s.vehicle_id} label={`Make a trip with ${s.registration_no}`} /> : <p className="text-xs text-zinc-500">Accept the request first, then make a trip with this vehicle.</p>}</div>
                  </li>
                ))}
              </ol>
            )}
            {suggest.suggestions.length > 5 && <p className="text-xs text-zinc-500">{suggest.suggestions.length - 5} more vehicle{suggest.suggestions.length - 5 === 1 ? "" : "s"} could carry it; the first five are shown.</p>}
            {suggest.weight_kg !== null && suggest.suggestions.length === 0 && (c.status === "accepted" || c.status === "in_transit") && (
              <MakeTrip {...step} label="Make a trip and ask logistics providers" intro="Opens a trip request without a vehicle. On the trip page you choose which logistics providers to ask for quotes." />
            )}
          </div>
        </Panel>
      )}
      {handler && (c.status === "accepted" || c.status === "in_transit") && !c.trip_id && <Panel title="Trip"><MakeTrip {...step} intro="Opens a trip request filled in from this one, without choosing a vehicle. A manager then approves it and assigns a vehicle and driver, or, on Pro, sends it to logistics providers for quotes." /></Panel>}
      {handler && c.status === "accepted" && <Panel title="On the way"><CargoStep {...step} to="in_transit" label="Mark as on the way" needsNote={false} /></Panel>}
      {handler && c.status === "in_transit" && <Panel title="Delivered"><CargoStep {...step} to="delivered" label="Mark as delivered" needsNote={false} /></Panel>}
      {(handler || c.mine) && (c.status === "requested" || c.status === "accepted") && !(handler && c.status === "requested" && !c.mine) && <Panel title="Cancel"><CargoStep {...step} to="cancelled" label="Cancel the request" needsNote /></Panel>}

      <Panel title="History" flush>
        <ol className="divide-y divide-zinc-100 text-sm">
          {c.events.map((e, i) => (
            <li key={i} className="flex flex-wrap gap-x-3 px-5 py-3"><span className="font-medium">{CARGO_STATUS_LABEL[e.to_status] ?? e.to_status}</span>
              <span className="text-zinc-500">{e.actor_name ?? "Someone"} · {dmyTime(e.created_at)}</span>{e.note && <span className="w-full text-zinc-700">{e.note}</span>}</li>
          ))}
        </ol>
      </Panel>
    </main>
  );
}
