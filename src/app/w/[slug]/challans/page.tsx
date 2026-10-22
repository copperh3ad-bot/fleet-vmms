import { Suspense } from "react";
import { ExportLink } from "@/components/export-link";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { listEmployeeOptions, listVehicles } from "@/lib/master/service";
import { listChallans } from "@/lib/compliance/service";
import { Card } from "@/components/form";
import { Tabs } from "../compliance/tabs";
import { ChallanForm, StatusButtons } from "./form";

export default function ChallansPage({ params, searchParams }: PageProps<"/w/[slug]/challans">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const LABEL: Record<string, string> = { open: "Open", paid: "Paid", disputed: "Disputed" };
const TONE: Record<string, string> = { open: "bg-amber-100 text-amber-800", paid: "bg-green-100 text-green-800", disputed: "bg-sky-100 text-sky-800" };

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const status = typeof sp.status === "string" && LABEL[sp.status] ? sp.status : "";
  const m = await requireMembership(slug);
  const driver = getDriver();
  const perms = await permissionsOf(driver, m);
  const manage = perms.has("compliance.manage");
  const [rows, vehicles, people] = await Promise.all([
    listChallans(driver, m, { status: status || undefined }),
    manage ? listVehicles(driver, m) : Promise.resolve([]),
    manage ? listEmployeeOptions(driver, m) : Promise.resolve([]),
  ]);
  const openTotal = rows.filter((r) => r.status === "open").reduce((s, r) => s + Number(r.amount), 0);
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold">Challans</h1>
      <Tabs slug={slug} active="challans" />
      {manage && <Card title="Add a challan"><ChallanForm slug={slug} vehicles={vehicles.map((v) => [v.id, v.registration_no])} people={people.map((p) => [p.id, p.full_name])} /></Card>}
      <nav className="flex flex-wrap items-center gap-2 text-sm" aria-label="Challan status">
        {[["", "All"], ...Object.entries(LABEL)].map(([k, l]) => (
          <a key={k} href={k ? `/w/${slug}/challans?status=${k}` : `/w/${slug}/challans`} aria-current={k === status ? "page" : undefined}
            className={`rounded-md border px-3 py-2 ${k === status ? "border-sky-800 bg-sky-800 text-white" : "border-zinc-300 bg-white"}`}>{l}</a>
        ))}
        {openTotal > 0 && <span className="ml-auto text-zinc-600">Open in this list: <span className="font-medium tabular-nums text-zinc-900">{openTotal.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span></span>}
      </nav>
      <div className="flex justify-end"><ExportLink slug={slug} kind="challans" query={{ status }} /></div>
      {rows.length === 0 ? <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center text-sm text-zinc-600">No challans.</p> : (
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-zinc-200 text-xs text-zinc-500"><tr><th className="p-3">Date</th><th className="p-3">Vehicle</th><th className="p-3">Driver</th><th className="p-3">Violation</th><th className="p-3 text-right">Amount</th><th className="p-3">Status</th>{manage && <th className="p-3">Change</th>}</tr></thead>
            <tbody>{rows.map((c) => (
              <tr key={c.id} className="border-b border-zinc-100 align-top last:border-0">
                <td className="p-3">{c.issued_on}{c.reference && <span className="block text-xs text-zinc-500">{c.reference}</span>}</td>
                <td className="p-3 font-medium">{c.registration_no}</td><td className="p-3">{c.driver_name ?? "—"}</td><td className="p-3">{c.violation ?? "—"}</td>
                <td className="p-3 text-right tabular-nums">{Number(c.amount).toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>
                <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs ${TONE[c.status]}`}>{LABEL[c.status]}</span>{c.paid_on && <span className="block text-xs text-zinc-500">{c.paid_on}</span>}</td>
                {manage && <td className="p-3"><StatusButtons slug={slug} id={c.id} status={c.status} /></td>}
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </main>
  );
}
