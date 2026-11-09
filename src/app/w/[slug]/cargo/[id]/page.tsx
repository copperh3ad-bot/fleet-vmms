import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { CARGO_STATUS_LABEL, getCargo, HANDLING } from "@/lib/cargo/service";
import { dmyTime } from "@/lib/format/date";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { CargoStep, MakeTrip } from "./steps";

export default function CargoDetailPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug);
  const driver = getDriver();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [c, perms] = await Promise.all([getCargo(driver, m, id), permissionsOf(driver, m)]);
  if (!c) notFound();
  const handler = perms.has("cargo.handle");
  const step = { slug, id };
  const dl = (k: string, v: React.ReactNode) => <div><dt className="text-zinc-500">{k}</dt><dd>{v}</dd></div>;
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader crumb={<a href={`/w/${slug}/cargo`} className="text-sky-800 hover:underline">Cargo</a>} title={c.cargo_no} sub={c.description} actions={<Pill>{CARGO_STATUS_LABEL[c.status] ?? c.status}</Pill>} />
      <Panel title="The request">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          {dl("Asked by", <>{c.requester_name}{c.source === "whatsapp" && <span className="ml-2 text-xs text-zinc-500">by WhatsApp</span>}</>)}
          {dl("What and how much", `${c.description}, ${c.quantity_text}`)}
          {dl("Collect from", c.pickup_place)}{dl("Collect on", dmyTime(c.pickup_at))}
          {dl("Pick-up contact", `${c.pickup_contact}, ${c.pickup_phone}`)}{dl("Deliver by", dmyTime(c.deliver_by))}
          {dl("Deliver to", c.drop_place)}{dl("Delivery contact", `${c.drop_contact}, ${c.drop_phone}`)}
          {dl("Special handling", c.handling ? (HANDLING[c.handling] ?? c.handling) : "None")}
          {c.department && dl("For", c.department)}
          {c.decision_note && dl("Note", c.decision_note)}
          {c.trip_id && dl("Trip", <a className="text-sky-800 hover:underline" href={`/w/${slug}/trips/${c.trip_id}`}>{c.trip_no}</a>)}
        </dl>
      </Panel>

      {handler && c.status === "requested" && <Panel title="Accept"><CargoStep {...step} to="accepted" label="Accept the request" needsNote={false} /></Panel>}
      {handler && c.status === "requested" && <Panel title="Reject"><CargoStep {...step} to="rejected" label="Reject the request" needsNote /></Panel>}
      {handler && (c.status === "accepted" || c.status === "in_transit") && !c.trip_id && <Panel title="Trip"><MakeTrip {...step} /></Panel>}
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
