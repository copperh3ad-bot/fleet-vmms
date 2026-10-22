import type { Flag } from "@/lib/analytics/service";
import { Pill } from "@/components/ui";

export const money = (n: number | string) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

export const FLAG_LABEL: Record<string, string> = {
  too_many_jobs: "Too many jobs", repeat_repair: "Repeat repair", cost_vs_peers: "Costs more than similar vehicles",
  over_budget: "Over budget", near_budget: "Near budget limit", document_expired: "Document expired", document_due: "Document due",
};

export function FlagList({ slug, flags, empty }: { slug: string; flags: Flag[]; empty: string }) {
  if (flags.length === 0) return <p className="text-sm text-zinc-500">{empty}</p>;
  return (
    <ul className="divide-y divide-zinc-100 text-sm">
      {flags.map((f, i) => (
        <li key={i} className="flex flex-wrap items-start gap-2 py-2.5">
          <Pill tone={f.severity === "high" ? "bad" : "warn"}>{FLAG_LABEL[f.flag] ?? f.flag}</Pill>
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
    <ul className="space-y-2 text-sm">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[8rem_1fr_auto] items-center gap-2">
          <span className="truncate text-zinc-700" title={r.label}>{r.label}</span>
          <span className="h-2.5 rounded bg-zinc-100"><span className="block h-2.5 rounded bg-brand" style={{ width: `${Math.max(r.value > 0 ? 2 : 0, (r.value / max) * 100)}%` }} /></span>
          <span className="font-mono text-zinc-900">{money(r.value)}{r.note && <span className="ml-1 font-sans text-xs text-zinc-500">{r.note}</span>}</span>
        </li>
      ))}
    </ul>
  );
}
