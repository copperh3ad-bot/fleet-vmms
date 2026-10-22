// Small building blocks that appear on most screens in the design: plates, status pills, KPI cards, page headers.
import type { ReactNode } from "react";

/** A registration plate: mono, dark 1.5px border, radius 4. */
export function Plate({ children, large }: { children: ReactNode; large?: boolean }) {
  return <span className={`inline-block whitespace-nowrap rounded-[4px] border-[1.5px] border-zinc-900 bg-white font-mono tracking-wider text-zinc-900 ${large ? "px-3 py-1 text-2xl" : "px-1.5 py-0.5 text-[13px] leading-tight"}`}>{children}</span>;
}

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";
const TONES: Record<Tone, string> = {
  ok: "bg-green-100 text-green-800", warn: "bg-amber-100 text-amber-800", bad: "bg-red-100 text-red-800",
  info: "bg-sky-100 text-sky-800", neutral: "bg-zinc-100 text-zinc-700",
};

/** Status is never colour alone: a pill always carries words. */
export function Pill({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

/** A number card. `href` makes the whole card a link. */
export function Kpi({ label, value, note, tone, href, mono = true }: { label: string; value: ReactNode; note?: ReactNode; tone?: Tone; href?: string; mono?: boolean }) {
  const body = (
    <>
      <p className="text-xs text-zinc-500">{label}</p>
      <p className={`mt-1 text-[28px] font-semibold leading-tight ${mono ? "font-mono" : ""}`}>{value}</p>
      {note && <p className="mt-1 text-xs text-zinc-500">{tone ? <Pill tone={tone}>{note}</Pill> : note}</p>}
    </>
  );
  const cls = "block rounded-lg border border-zinc-200 bg-white p-4";
  return href ? <a href={href} className={`${cls} hover:border-zinc-300`}>{body}</a> : <div className={cls}>{body}</div>;
}

/** Title, one line of context, and the main actions on the right. */
export function PageHeader({ title, sub, actions, crumb }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode; crumb?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        {crumb && <p className="text-sm text-zinc-500">{crumb}</p>}
        <h1 className="text-[22px] font-semibold leading-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-zinc-500">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export const btn = "inline-flex h-10 items-center rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50";
export const btnPrimary = "inline-flex h-10 items-center rounded-md bg-brand px-4 text-sm font-medium text-white hover:opacity-90";

/** Money as the design shows it: whole units, thousands separated, in mono. */
export const money = (n: number | string) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 });
