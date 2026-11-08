import { Suspense } from "react";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { dmyTime } from "@/lib/format/date";
import { ACTIVITY_KINDS, listActivity, type ActivityFilter, type ActivityRow } from "@/lib/activity/read";
import { logActivity } from "@/lib/activity/log";
import { PageHeader, Panel, Pill } from "@/components/ui";

export default function ActivityPage({ searchParams }: PageProps<"/admin/activity">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner searchParams={searchParams} /></Suspense>;
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined;
const TONE = { ok: "ok", denied: "warn", invalid: "neutral", error: "bad", info: "info" } as const;
const OUTCOME_LABEL: Record<string, string> = { ok: "Worked", denied: "Refused", invalid: "Not accepted", error: "Failed", info: "Note" };

async function Inner({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const op = await requireOperator();
  const f: ActivityFilter = {
    kind: one(sp.kind), outcome: one(sp.outcome), q: one(sp.q), from: one(sp.from), to: one(sp.to), tenant: one(sp.tenant), actor: one(sp.actor), request: one(sp.request),
    page: Number(one(sp.page)) || 1,
  };
  const { rows, page, more } = await listActivity(getDriver(), op.id, f);
  await logActivity({ kind: "security", name: "activity log viewed", outcome: "info", actorId: op.id, role: "operator", details: { filters: { ...f, page: undefined } } });
  const qs = (extra: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...f, ...extra })) if (v !== undefined && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v));
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  const input = "h-9 rounded-md border border-zinc-300 bg-white px-2 text-sm";
  return (
    <main className="mx-auto max-w-[96rem] space-y-5 p-6 text-zinc-900">
      <PageHeader title="Activity" sub="Everything the software did: who did what, whether it worked, and every error. Entries cannot be changed or deleted, and are cleared after 400 days." />
      <Panel>
        <form method="get" className="flex flex-wrap items-end gap-3 text-sm">
          <label className="grid gap-1">Kind
            <select name="kind" defaultValue={f.kind ?? ""} className={input}><option value="">All</option>{ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
          </label>
          <label className="grid gap-1">Result
            <select name="outcome" defaultValue={f.outcome ?? ""} className={input}>
              <option value="">All</option><option value="problem">Problems (refused or failed)</option><option value="ok">Worked</option><option value="denied">Refused</option><option value="invalid">Not accepted</option><option value="error">Failed</option>
            </select>
          </label>
          <label className="grid gap-1">From<input type="date" name="from" defaultValue={f.from ?? ""} className={input} /></label>
          <label className="grid gap-1">To<input type="date" name="to" defaultValue={f.to ?? ""} className={input} /></label>
          <label className="grid min-w-56 flex-1 gap-1">Search<input name="q" defaultValue={f.q ?? ""} placeholder="action, account, page or error" className={input} /></label>
          <button type="submit" className="h-9 rounded-md bg-zinc-900 px-4 font-medium text-white">Filter</button>
          <a className="h-9 content-center text-zinc-600 underline" href="/admin/activity">Clear</a>
          <a className="h-9 content-center text-zinc-600 underline" href={`/admin/activity/export${qs({ page: undefined })}`}>Download CSV</a>
        </form>
        {(f.request || f.tenant || f.actor) && (
          <p className="mt-3 text-sm text-zinc-600">
            Showing {f.request ? "one request" : f.actor ? "one person" : "one company"}. <a className="underline" href={`/admin/activity${qs({ request: undefined, tenant: undefined, actor: undefined, page: undefined })}`}>Show everything</a>
          </p>
        )}
      </Panel>
      <Panel flush>
        {rows.length === 0 ? <p className="p-5 text-sm text-zinc-500">Nothing matches.</p> : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Activity entries">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-zinc-500"><tr><th className="px-4 py-3">When</th><th>Result</th><th>What</th><th>Who</th><th>Company</th><th>Where</th><th className="px-4">Took</th></tr></thead>
              <tbody>{rows.map((r) => <Row key={r.id} r={r} qs={qs} />)}</tbody>
            </table>
          </div>
        )}
      </Panel>
      <nav className="flex items-center gap-4 text-sm" aria-label="Pages">
        {page > 1 && <a className="underline" href={`/admin/activity${qs({ page: page - 1 })}`}>Newer</a>}
        <span className="text-zinc-500">Page {page}</span>
        {more && <a className="underline" href={`/admin/activity${qs({ page: page + 1 })}`}>Older</a>}
      </nav>
    </main>
  );
}

function Row({ r, qs }: { r: ActivityRow; qs: (e: Record<string, string | number | undefined>) => string }) {
  const who = r.actor_email ?? r.subject ?? (r.role === "operator" ? "Operator" : "");
  const extra = !!r.error_message || r.details != null;
  return (
    <tr className="border-t border-zinc-100 align-top">
      <td className="whitespace-nowrap px-4 py-2 text-zinc-600">{dmyTime(r.at)}</td>
      <td className="py-2"><Pill tone={TONE[r.outcome as keyof typeof TONE] ?? "neutral"}>{OUTCOME_LABEL[r.outcome] ?? r.outcome}</Pill></td>
      <td className="py-2">
        <p className="font-medium">{r.name} <span className="font-normal text-zinc-500">({r.kind})</span></p>
        {r.error_class && <p className="text-xs text-red-700">{r.error_class}{r.error_digest ? ` · digest ${r.error_digest}` : ""}</p>}
        {extra && (
          <details className="mt-1 text-xs text-zinc-600">
            <summary className="cursor-pointer">Details</summary>
            {r.error_message && <p className="mt-1 whitespace-pre-wrap break-words">{r.error_message}</p>}
            {r.details != null && <pre className="mt-1 max-w-xl overflow-x-auto whitespace-pre-wrap break-words rounded bg-zinc-50 p-2">{JSON.stringify(r.details, null, 2)}</pre>}
            {r.request_id && <p className="mt-1"><a className="underline" href={`/admin/activity${qs({ request: r.request_id, page: undefined })}`}>Everything in this request</a></p>}
          </details>
        )}
      </td>
      <td className="py-2">{r.actor_id ? <a className="underline" href={`/admin/activity${qs({ actor: r.actor_id, page: undefined })}`}>{who || "Person"}</a> : who || <span className="text-zinc-400">Nobody signed in</span>}{r.role && r.role !== "operator" && <span className="block text-xs text-zinc-500">{r.role}</span>}</td>
      <td className="py-2">{r.tenant_id ? <a className="underline" href={`/admin/activity${qs({ tenant: r.tenant_id, page: undefined })}`}>{r.tenant_name ?? "Company"}</a> : ""}</td>
      <td className="py-2 text-xs text-zinc-600">{r.method ? `${r.method} ` : ""}{r.path}{r.status ? ` · ${r.status}` : ""}{r.ip && <span className="block text-zinc-400">{r.ip}</span>}</td>
      <td className="px-4 py-2 text-xs text-zinc-500">{r.duration_ms == null ? "" : `${r.duration_ms} ms`}</td>
    </tr>
  );
}
