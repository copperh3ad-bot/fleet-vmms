import { dmyTime as when } from "@/lib/format/date";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { assignables, getTrip, listLogisticsProviders, listTripQuotes, outsourcingOn, tripsEnabled, TRIP_STATUS_LABEL } from "@/lib/trips/service";
import { PageHeader, Panel, Pill, Plate } from "@/components/ui";
import { TripStep } from "./steps";
import { AskProviders, AwardForm, DeclineButton, QuoteForm } from "./outsource";

export default function TripPage({ params }: PageProps<"/w/[slug]/trips/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}


async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug);
  const driver = getDriver();
  if (!(await tripsEnabled(driver, m))) return <main className="p-6 text-sm text-zinc-600">Trips are not switched on for this organization.</main>;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const [t, perms] = await Promise.all([getTrip(driver, m, id), permissionsOf(driver, m)]);
  if (!t) notFound();
  const approver = perms.has("trip.approve") || (t.dispatchable && perms.has("trip.dispatch"));
  const canCancel = approver || (t.requested_by_me && perms.has("trip.request"));
  const lists = approver && t.status === "requested" ? await assignables(driver, m, { poolOnly: t.kind === "pick_drop" }) : null;
  const step = { slug, id };
  // Sending the trip to logistics providers for quotes (ADR-078): a Pro feature, for people who may award.
  const outsourcing = perms.has("trip.award") && (await outsourcingOn(driver, m));
  const quotes = outsourcing ? await listTripQuotes(driver, m, id) : [];
  const providers = outsourcing && t.status === "requested" ? await listLogisticsProviders(driver, m) : [];
  const outsourced = !!t.outsourced_vendor;
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
          {outsourced ? <>
            <div><dt className="text-zinc-500">Logistics provider</dt><dd>{t.outsourced_vendor}{t.award_amount ? ` · ${Number(t.award_amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : ""}</dd></div>
            <div><dt className="text-zinc-500">Their vehicle and driver</dt><dd>{[t.vendor_vehicle_text, t.vendor_driver_text].filter(Boolean).join(" · ") || "Not given"}</dd></div>
          </> : <>
            <div><dt className="text-zinc-500">Vehicle</dt><dd>{t.registration_no ? <Plate>{t.registration_no}</Plate> : "Not assigned yet"}</dd></div>
            <div><dt className="text-zinc-500">Driver</dt><dd>{t.driver_name ?? "Not assigned yet"}</dd></div>
            <div><dt className="text-zinc-500">Odometer out / back</dt><dd>{t.odometer_out ?? "—"} / {t.odometer_in ?? "—"}{t.distance_km ? ` · ${Number(t.distance_km).toLocaleString("en-US")} km` : ""}</dd></div>
          </>}
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
      {outsourcing && (t.status === "requested" || quotes.length > 0) && (
        <Panel title="Logistics providers">
          <div className="space-y-5">
            {t.status === "requested" && <AskProviders slug={slug} id={id} providers={providers} asked={quotes.map((x) => x.vendor_id)} />}
            {quotes.map((x) => (
              <div key={x.id} className="space-y-3 border-t border-zinc-100 pt-4 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-medium">{x.vendor_name}</span>
                  <Pill>{{ requested: "Waiting for a quote", quoted: "Quoted", declined: "Declined", awarded: "Awarded", closed: "Closed" }[x.status] ?? x.status}</Pill>
                  {x.amount && <span>{Number(x.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>}
                  {x.valid_until && <span className="text-zinc-500">valid until {x.valid_until}</span>}
                </div>
                {(x.vehicle_text || x.driver_text || x.notes) && <p className="text-zinc-600">{[x.vehicle_text, x.driver_text, x.notes].filter(Boolean).join(" · ")}</p>}
                {t.status === "requested" && ["requested", "quoted", "declined"].includes(x.status) && (
                  <details><summary className="cursor-pointer text-sky-800">{x.status === "quoted" ? "Correct the quote" : "Enter the quote"}</summary>
                    <div className="mt-3"><QuoteForm slug={slug} quoteId={x.id} current={x.status === "quoted" ? x : undefined} /></div></details>
                )}
                {t.status === "requested" && x.status === "quoted" && <AwardForm slug={slug} id={id} quoteId={x.id} vendor={x.vendor_name} />}
                {t.status === "requested" && x.status === "requested" && <DeclineButton slug={slug} quoteId={x.id} />}
              </div>
            ))}
          </div>
        </Panel>
      )}
      {t.status === "requested" && approver && <Panel title="Reject"><TripStep {...step} to="rejected" label="Reject trip" fields={["note"]} /></Panel>}
      {t.status === "approved" && (approver || t.mine) && <Panel title="Departure"><TripStep {...step} to="started" label="Mark as left" fields={outsourced ? [] : ["odometer"]} /></Panel>}
      {t.status === "started" && (approver || t.mine) && <Panel title="Return"><TripStep {...step} to="completed" label="Mark as returned" fields={outsourced ? [] : ["odometer"]} /></Panel>}
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
