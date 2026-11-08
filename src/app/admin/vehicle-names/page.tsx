import { Suspense } from "react";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { dmy } from "@/lib/format/date";
import { listSuggestions, mergeTargets, type QueueView, type Suggestion } from "@/lib/master/vehicle-names";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { approveVehicleNameAction, rejectVehicleNameAction } from "../actions";
import { MiniForm } from "../forms";
import { MergeForm } from "./merge-form";

export default function VehicleNamesPage({ searchParams }: PageProps<"/admin/vehicle-names">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner searchParams={searchParams} /></Suspense>;
}

const VIEWS: [QueueView, string][] = [["pending", "To review"], ["approved", "Approved"], ["merged", "Merged"], ["rejected", "Rejected"]];

async function Inner({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const op = await requireOperator();
  const view = (VIEWS.find(([v]) => v === sp.view)?.[0] ?? "pending") as QueueView;
  const [rows, targets] = await Promise.all([listSuggestions(getDriver(), op.id, view), view === "pending" ? mergeTargets(getDriver(), op.id) : Promise.resolve({})]);
  const tab = (on: boolean) => `rounded-full border px-4 py-1.5 text-sm ${on ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white hover:bg-zinc-50"}`;
  return (
    <main className="mx-auto max-w-5xl 2xl:max-w-6xl space-y-5 p-6 text-zinc-900">
      <PageHeader title="Vehicle names" sub="Makes and models owners typed because our list did not have them. Their vehicles are already saved. Approve a real name to add it to everyone's list, merge a spelling variant into the name we have, or reject a mistake." />
      <nav className="flex gap-2" aria-label="Status">
        {VIEWS.map(([v, l]) => <a key={v} href={`/admin/vehicle-names${v === "pending" ? "" : `?view=${v}`}`} className={tab(view === v)} aria-current={view === v ? "page" : undefined}>{l}</a>)}
      </nav>
      {rows.length === 0 ? <Panel><p className="text-sm text-zinc-500">{view === "pending" ? "Nothing to review." : "Nothing here."}</p></Panel> : rows.map((r) => <Card key={r.id} r={r} view={view} targets={targets} />)}
    </main>
  );
}

function Card({ r, view, targets }: { r: Suggestion; view: QueueView; targets: Record<string, string[]> }) {
  const isModel = r.model !== null;
  const name = isModel ? `${r.make} ${r.model}` : r.make;
  return (
    <Panel title={name} sub={`${isModel ? "A model" : "A make"} · used on ${r.uses} vehicle${r.uses === 1 ? "" : "s"} by ${r.companies} ${r.companies === 1 ? "company" : "companies"} · first typed ${dmy(r.first_seen)}${r.first_company ? ` by ${r.first_company}` : ""}`}
      action={<Pill tone={r.status === "approved" ? "ok" : r.status === "rejected" ? "bad" : r.status === "merged" ? "info" : "warn"}>{r.status === "pending" ? "To review" : r.status[0].toUpperCase() + r.status.slice(1)}</Pill>}>
      {view === "pending" ? (
        <div className="space-y-4">
          <div>
            <p className="mb-1 text-sm font-medium">Add it to the list</p>
            <MiniForm action={approveVehicleNameAction.bind(null, r.id)} button="Approve"
              fields={[{ name: "make", label: "Make (fix capitals or spelling)", defaultValue: r.make }, ...(isModel ? [{ name: "model", label: "Model", defaultValue: r.model ?? "" }] : [])]} />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">Or it is another spelling of a name we already have</p>
            <MergeForm id={r.id} isModel={isModel} targets={targets} label="Same as" />
          </div>
          <div>
            <p className="mb-1 text-sm font-medium">Or it is a mistake or not a vehicle</p>
            <MiniForm action={rejectVehicleNameAction.bind(null, r.id)} button="Reject" danger fields={[{ name: "note", label: "Reason (kept for the record)", width: "w-72" }]} />
          </div>
        </div>
      ) : (
        <p className="text-sm text-zinc-600">
          {r.status === "merged" && <>Merged into <strong>{r.merged_model ? `${r.merged_make} ${r.merged_model}` : r.merged_make}</strong>. </>}
          {r.decided_at && <>Decided {dmy(r.decided_at)}. </>}{r.decision_note && <>Reason: {r.decision_note}</>}
        </p>
      )}
    </Panel>
  );
}
