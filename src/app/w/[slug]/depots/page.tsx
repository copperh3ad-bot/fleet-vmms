import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { DEPOT_KINDS, listDepots } from "@/lib/depots/service";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { DepotForm, DepotSwitch } from "./form";

export default function DepotsPage({ params }: { params: Promise<{ slug: string }> }) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug, { fullScope: true });
  const driver = getDriver();
  const perms = await permissionsOf(driver, m);
  const manage = perms.has("depot.manage");
  const depots = await listDepots(driver, m);
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Depots and places" sub="The places your company works from. Forms suggest them, so the same place is always spelled the same way and the system can tell where a vehicle is." />
      {manage && <Panel title="Add a place"><DepotForm slug={slug} /></Panel>}
      <Panel title={`Your places (${depots.filter((d) => d.active).length})`} flush>
        {depots.length === 0 ? <p className="p-5 text-sm text-zinc-500">No place yet. {manage ? "Add your depots, yards and offices above." : "Ask an administrator or fleet manager to add them."}</p> : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {depots.map((d) => (
              <li key={d.id} className="px-5 py-3">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className={`font-medium ${d.active ? "" : "text-zinc-400 line-through"}`}>{d.name}</span>
                  <span className="text-zinc-500">{[DEPOT_KINDS[d.kind] ?? d.kind, d.city].filter(Boolean).join(" · ")}</span>
                  <span className="text-zinc-500">{d.vehicles === 0 ? "no vehicle based here" : `${d.vehicles} vehicle${d.vehicles === 1 ? "" : "s"} based here`}</span>
                  {!d.active && <Pill tone="neutral">Off the list</Pill>}
                  {manage && <DepotSwitch slug={slug} id={d.id} active={d.active} name={d.name} />}
                </div>
                {manage && d.active && <details className="mt-2"><summary className="cursor-pointer text-xs text-sky-800">Change</summary><div className="mt-2"><DepotForm slug={slug} id={d.id} initial={{ name: d.name, city: d.city, kind: d.kind }} /></div></details>}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}
