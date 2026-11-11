import { dmyTime as when, dmy as day } from "@/lib/format/date";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { getVehicleRequest, poolVehicles, VREQ_STATUS_LABEL } from "@/lib/vehicle-requests/service";
import { PageHeader, Panel, Pill, Plate, money } from "@/components/ui";
import { DealerQuoteForm, RemoveDealerQuote } from "./quotes";
import { VehicleRequestStep } from "./steps";

const OPEN = ["requested", "budget_confirmed", "purchase_approved"];

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
  const canConfirm = perms.has("vreq.confirm_budget") && r.for_user !== m.userId && (r.status === "requested" || r.status === "budget_confirmed");
  const canQuote = (r.status === "requested" || r.status === "budget_confirmed") && (perms.has("vreq.decide") || perms.has("vreq.assign") || perms.has("vreq.confirm_budget") || (r.requested_by_me && perms.has("vreq.request")));
  const showPurchase = r.purchase_budget !== null || r.quotes.length > 0 || canQuote || r.status === "purchase_approved";
  const canCancel = (perms.has("vreq.decide") || perms.has("vreq.assign") || (r.requested_by_me && perms.has("vreq.request"))) && OPEN.includes(r.status);
  const pool = assigner && OPEN.includes(r.status) ? await poolVehicles(driver, m) : [];
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

      {showPurchase && (
        <Panel title="Buying a vehicle" sub="When no vehicle in the pool fits: Finance confirms a budget, a Fleet Manager or Administrator approves the purchase, and adding the vehicle hands it over.">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-zinc-500">Budget confirmed by Finance</dt><dd>{r.purchase_budget ? <span className="font-mono">{money(Number(r.purchase_budget))}</span> : "Not yet"}</dd></div>
            <div><dt className="text-zinc-500">Needed from</dt><dd>{day(r.needed_from)}</dd></div>
          </dl>
          <h3 className="mt-4 text-sm font-medium">Dealer quotations</h3>
          {r.quotes.length === 0 ? <p className="mt-1 text-sm text-zinc-500">None recorded yet. {canQuote ? "Add the quotations you have; the lowest shows first." : ""}</p> : (
            <ul className="mt-1 divide-y divide-zinc-100 text-sm">
              {r.quotes.map((k) => (
                <li key={k.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                  <span className="font-mono font-medium">{money(Number(k.amount))}</span><span>{k.dealer}</span><span className="text-zinc-600">{k.vehicle}</span>
                  {k.valid_until && <span className="text-zinc-500">valid until {day(k.valid_until)}</span>}
                  {r.purchase_budget && Number(k.amount) > Number(r.purchase_budget) && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">above the budget</span>}
                  {k.note && <span className="w-full text-zinc-600">{k.note}</span>}
                  {canQuote && (k.mine || perms.has("vreq.decide")) && <RemoveDealerQuote slug={slug} quoteId={k.id} label={k.dealer} />}
                </li>
              ))}
            </ul>
          )}
          {canQuote && <DealerQuoteForm slug={slug} id={id} />}
          {r.status === "purchase_approved" && perms.has("vreq.assign") && perms.has("vehicle.write") && r.for_user !== m.userId && (
            <p className="mt-4 rounded-md bg-sky-50 p-3 text-sm text-sky-900">The purchase is approved. When the vehicle arrives, <a className="font-medium underline" href={`/w/${slug}/vehicles/new?request=${id}`}>add it here</a>: saving it closes this request and makes {r.for_name} its holder.</p>
          )}
          {r.status === "purchase_approved" && !(perms.has("vreq.assign") && perms.has("vehicle.write")) && <p className="mt-4 text-sm text-zinc-600">The purchase is approved. The request closes when the vehicle is added.</p>}
        </Panel>
      )}

      {assigner && OPEN.includes(r.status) && (
        <Panel title="Give a vehicle from the pool" sub="Vehicles that are in service and that nobody holds at the moment. The employee becomes its holder.">
          {pool.length === 0 ? <p className="text-sm text-zinc-500">No vehicle is free. Buy one (see above), and it is handed over when it is added.</p>
            : <VehicleRequestStep {...step} to="assigned" label="Give this vehicle" fields={["vehicle", "note"]} vehicles={pool.map((v) => ({ id: v.id, warnings: v.warnings, label: [v.registration_no, v.label, v.vehicle_class, v.seats ? `${v.seats} seats` : "", v.load_capacity_kg ? `${v.load_capacity_kg} kg` : "", v.base_location].filter(Boolean).join(" · ") }))} />}
        </Panel>
      )}
      {canConfirm && <Panel title={r.status === "budget_confirmed" ? "Change the budget" : "Confirm the budget for buying one"} sub="Finance confirms how much may be spent. The purchase cannot be approved before this."><VehicleRequestStep {...step} to="budget_confirmed" label="Confirm the budget" fields={["amount", "note"]} /></Panel>}
      {decider && r.status === "budget_confirmed" && <Panel title="Approve buying one" sub={`Budget confirmed: ${money(Number(r.purchase_budget))}. ${r.quotes.length === 0 ? "No dealer quotation has been recorded yet." : `Lowest quotation: ${money(Number(r.quotes[0].amount))} (${r.quotes[0].dealer}).`}`}><VehicleRequestStep {...step} to="purchase_approved" label="Approve the purchase" fields={["note"]} /></Panel>}
      {decider && (r.status === "requested" || r.status === "budget_confirmed") && <Panel title="Reject"><VehicleRequestStep {...step} to="rejected" label="Reject request" fields={["note"]} /></Panel>}
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
