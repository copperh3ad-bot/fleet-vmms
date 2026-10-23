import { Suspense } from "react";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listOrganizations } from "@/lib/billing/operator";
import { formatPrice } from "@/lib/billing/offer";
import { Kpi, PageHeader, Panel, Pill, type Tone } from "@/components/ui";

export default function AdminHome() {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner /></Suspense>;
}

const STATE: Record<string, { label: string; tone: Tone }> = {
  trial: { label: "Trial", tone: "info" }, active: { label: "Paying", tone: "ok" }, grace: { label: "Overdue", tone: "warn" },
  ending: { label: "Ending", tone: "warn" }, locked: { label: "Locked", tone: "bad" }, comped: { label: "No charge", tone: "neutral" },
};
const dmy = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

async function Inner() {
  const op = await requireOperator();
  const orgs = (await listOrganizations(getDriver(), op.id)).filter((o) => o.status !== "closed");
  const count = (s: string) => orgs.filter((o) => o.access.state === s).length;
  const mrr = orgs.filter((o) => o.access.state === "active" || o.access.state === "grace").reduce((n, o) => n + (o.billing?.price_cents ?? 0), 0);
  return (
    <main className="mx-auto max-w-6xl space-y-5 p-6 text-zinc-900">
      <PageHeader title="Organizations" sub={`${orgs.length} in total`} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi label="On a trial" value={count("trial")} />
        <Kpi label="Paying" value={count("active") + count("grace")} note={mrr ? `${formatPrice(mrr, "USD")} a month` : undefined} />
        <Kpi label="Locked" value={count("locked")} tone={count("locked") ? "warn" : undefined} />
        <Kpi label="Payments to check" value={orgs.reduce((n, o) => n + o.pending_claims, 0)} tone={orgs.some((o) => o.pending_claims) ? "warn" : undefined} href="/admin/payments" />
      </div>
      <Panel flush>
        {orgs.length === 0 ? <p className="p-5 text-sm text-zinc-500">No organizations yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Organization</th><th>Status</th><th>Until</th><th>Database</th><th className="text-right">People</th><th>Created</th><th className="px-5" /></tr></thead>
            <tbody>{orgs.map((o) => (
              <tr key={o.id} className="border-t border-zinc-100">
                <td className="px-5 py-3 font-medium"><a className="text-sky-800 underline" href={`/admin/orgs/${o.id}`}>{o.name}</a><span className="block text-xs font-normal text-zinc-500">{o.slug}</span></td>
                <td className="py-3"><Pill tone={STATE[o.access.state].tone}>{STATE[o.access.state].label}</Pill>{o.pending_claims > 0 && <span className="ml-2"><Pill tone="warn">Payment waiting</Pill></span>}</td>
                <td className="py-3">{o.access.until ? dmy(o.access.until) : "—"}</td>
                <td className="py-3">{o.db_kind === "dedicated" ? "Own" : "Shared"}{o.provision_state !== "ready" && <span className="ml-1 text-xs text-amber-800">({o.provision_state.replace("_", " ")})</span>}</td>
                <td className="py-3 text-right font-mono">{o.members}</td>
                <td className="py-3">{dmy(o.created_at)}</td>
                <td className="px-5 py-3 text-right"><a className="text-sky-800 underline" href={`/admin/orgs/${o.id}`}>Open</a></td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Panel>
    </main>
  );
}
