import type { Flag } from "@/lib/analytics/service";

export const money = (n: number | string) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

export const FLAG_LABEL: Record<string, string> = {
  too_many_jobs: "Too many jobs", repeat_repair: "Repeat repair", cost_vs_peers: "Costs more than similar vehicles",
  over_budget: "Over budget", near_budget: "Near budget limit", document_expired: "Document expired", document_due: "Document due",
};

export function ReportTabs({ slug, active }: { slug: string; active: "costs" | "breaking" }) {
  return (
    <nav className="flex gap-2 text-sm" aria-label="Report sections">
      {([["costs", "reports", "Costs"], ["breaking", "reports/breaking", "Why it keeps breaking"]] as const).map(([k, path, l]) => (
        <a key={k} href={`/w/${slug}/${path}`} aria-current={k === active ? "page" : undefined}
          className={`rounded-md border px-3 py-2 ${k === active ? "border-sky-800 bg-sky-800 text-white" : "border-zinc-300 bg-white"}`}>{l}</a>
      ))}
    </nav>
  );
}

export function FlagList({ slug, flags, empty }: { slug: string; flags: Flag[]; empty: string }) {
  if (flags.length === 0) return <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-4 text-sm text-zinc-600">{empty}</p>;
  return (
    <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 bg-white text-sm">
      {flags.map((f, i) => (
        <li key={i} className="flex flex-wrap items-start gap-2 p-3">
          <span className={`mt-0.5 rounded-full px-2 py-0.5 text-xs ${f.severity === "high" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}>{FLAG_LABEL[f.flag] ?? f.flag}</span>
          <span className="min-w-0 flex-1">
            {f.vehicle_id ? <a className="font-medium text-sky-800 hover:underline" href={`/w/${slug}/vehicles/${f.vehicle_id}`}>{f.registration_no}</a> : <span className="font-medium">Whole fleet</span>}
            <span className="text-zinc-700"> · {f.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Simple horizontal bars, no chart library. */
export function Bars({ rows }: { rows: { label: string; value: number; note?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1.5 text-sm">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[8rem_1fr_auto] items-center gap-2">
          <span className="truncate text-zinc-700" title={r.label}>{r.label}</span>
          <span className="h-3 rounded bg-zinc-100"><span className="block h-3 rounded bg-sky-700" style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%` }} /></span>
          <span className="tabular-nums text-zinc-900">{money(r.value)}{r.note && <span className="ml-1 text-xs text-zinc-500">{r.note}</span>}</span>
        </li>
      ))}
    </ul>
  );
}
