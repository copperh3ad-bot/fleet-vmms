import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { fleetOpsOn, FLEET_OPS_MESSAGE } from "@/lib/billing/fleet-ops";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { CARGO_STATUS_LABEL, listCargo } from "@/lib/cargo/service";
import { dmyTime } from "@/lib/format/date";
import { btnPrimary, PageHeader, Panel, Pill, type Tone } from "@/components/ui";

export default function CargoPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ status?: string }> }) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const TONE: Record<string, Tone> = { requested: "warn", accepted: "info", in_transit: "info", delivered: "ok", rejected: "bad", cancelled: "neutral" };

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ status?: string }> }) {
  const { slug } = await params;
  const { status } = await searchParams;
  const m = await requireMembership(slug);
  if (!(await fleetOpsOn(getDriver(), m.tenantId))) return <main className="p-6 text-sm text-zinc-600">{FLEET_OPS_MESSAGE}</main>;
  const driver = getDriver();
  const [rows, perms] = await Promise.all([listCargo(driver, m, { status: status && CARGO_STATUS_LABEL[status] ? status : undefined }), permissionsOf(driver, m)]);
  const handler = perms.has("cargo.handle");
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Cargo" sub={`${rows.length} shown${handler ? "" : ", your requests"}`} actions={perms.has("cargo.request") ? <a href={`/w/${slug}/cargo/new`} className={btnPrimary}>Ask for a pick-up and delivery</a> : undefined} />
      <nav aria-label="Status" className="flex flex-wrap gap-2 text-sm">
        {[["", "All"], ...Object.entries(CARGO_STATUS_LABEL)].map(([k, label]) => (
          <a key={k} href={k ? `/w/${slug}/cargo?status=${k}` : `/w/${slug}/cargo`} aria-current={(status ?? "") === k ? "page" : undefined} className={`rounded-full border px-3 py-1 ${(status ?? "") === k ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white"}`}>{label}</a>
        ))}
      </nav>
      <Panel flush>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Request</th><th>What</th><th className="hidden md:table-cell">Route</th><th className="hidden md:table-cell">Collect</th><th className="hidden md:table-cell">Asked by</th><th className="px-5">Status</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-zinc-500">No cargo requests yet.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 align-top">
                <td className="px-5 py-3 font-medium"><a className="text-sky-800 hover:underline" href={`/w/${slug}/cargo/${r.id}`}>{r.cargo_no}</a><span className="mt-1 block text-xs font-normal text-zinc-500 md:hidden">{r.pickup_place} to {r.drop_place}</span></td>
                <td className="py-3">{r.description}<span className="block text-xs text-zinc-500">{r.quantity_text}</span></td>
                <td className="hidden py-3 md:table-cell">{r.pickup_place} to {r.drop_place}</td>
                <td className="hidden py-3 md:table-cell">{dmyTime(r.pickup_at)}</td>
                <td className="hidden py-3 md:table-cell">{r.requester_name}{r.source === "whatsapp" && <span className="block text-xs text-zinc-500">by WhatsApp</span>}</td>
                <td className="px-5 py-3"><Pill tone={TONE[r.status] ?? "neutral"}>{CARGO_STATUS_LABEL[r.status] ?? r.status}</Pill></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Panel>
    </main>
  );
}
