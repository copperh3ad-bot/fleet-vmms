import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { getCycle, type SubmissionRow } from "@/lib/odometer/service";
import { PageHeader, Panel, Pill, Plate, btn } from "@/components/ui";
import { dayMonth, plural } from "@/lib/labels";
import { ApproveAll, ApproveOne, CloseButton, EnterReading, HeldReview, RemindAll, RemindOne, RevokeButton } from "../forms";

export default function CyclePage({ params, searchParams }: PageProps<"/w/[slug]/odometer/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

const monthName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const km = (s: string | number) => `${Number(s).toLocaleString("en-US", { maximumFractionDigits: 1 })} km`;
const car = (r: SubmissionRow) => [r.make, r.model, r.year].filter(Boolean).join(" ");
const TABS = [["review", "Needs review"], ["held", "Held for checking"], ["pending", "Not submitted"], ["approved", "Approved"]] as const;

async function Inner({ params, searchParams }: { params: Promise<{ slug: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug, id } = await params;
  const sp = await searchParams;
  const m = await requireMembership(slug, { fullScope: true });
  const d = await getCycle(getDriver(), m, id);
  if (!d) notFound();
  const open = d.cycle.status === "open";
  const c = d.counts;
  const tab = TABS.some(([k]) => k === sp.tab) ? String(sp.tab) : c.review > 0 ? "review" : c.pending > 0 ? "pending" : "approved";
  const to = (p: string) => `/w/${slug}/${p}`;
  const count: Record<string, number> = { review: c.review, held: c.held, pending: c.pending, approved: c.approved };
  const shown = d.rows.filter((r) => tab === "review" ? r.status === "submitted" : tab === "held" ? r.verdict && r.verdict !== "normal" : tab === "pending" ? ["pending", "rejected"].includes(r.status) : r.status === "approved");
  // held first, then the normal ones
  if (tab === "review") shown.sort((a, b) => Number(b.verdict !== "normal") - Number(a.verdict !== "normal") || a.registration_no.localeCompare(b.registration_no));
  const normalShown = shown.filter((r) => r.verdict === "normal").length;
  const pct = (n: number) => (c.total ? (n / c.total) * 100 : 0);

  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader crumb={<a className="underline" href={to("odometer")}>All months</a>} title={`Odometer readings, ${monthName(d.cycle.period)}`}
        sub={`Opened ${dayMonth(d.cycle.opened_at)} · due ${dayMonth(d.cycle.due_on)} · ${open ? (d.cycle.days_left >= 0 ? `${plural(d.cycle.days_left, "day")} left` : `${-d.cycle.days_left} days overdue`) : "closed"}`}
        actions={open ? <><a href={`?tab=pending`} className={btn}>Enter a reading for a driver</a><CloseButton slug={slug} cycleId={id} /></> : undefined} />

      <Panel>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-zinc-100" role="img" aria-label={`${c.approved} approved, ${c.review} need review, ${c.pending} not submitted`}>
          <div className="bg-green-700" style={{ width: `${pct(c.approved)}%` }} /><div className="bg-amber-500" style={{ width: `${pct(c.review)}%` }} />
        </div>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-8 gap-y-1 text-sm">
          <span><span className="font-mono text-[22px] font-semibold">{c.approved}</span> approved</span>
          <span><span className="font-mono text-[22px] font-semibold">{c.review}</span> need your review</span>
          <span><span className="font-mono text-[22px] font-semibold">{c.pending}</span> not submitted yet</span>
          <span className="text-xs text-zinc-500 sm:ml-auto">Rules: a reading below the last one, or above {d.rules.maxKmPerDay} km a day, is held for you. Stale after {d.rules.staleDays} days.</span>
        </div>
        {open && c.pending > 0 && <div className="mt-4 border-t border-zinc-100 pt-4"><RemindAll slug={slug} cycleId={id} waiting={c.pending} /></div>}
      </Panel>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Readings">
        {TABS.map(([k, label]) => (
          <a key={k} href={`?tab=${k}`} aria-current={k === tab ? "true" : undefined}
            className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm ${k === tab ? "border-zinc-900 bg-zinc-900 text-white" : "border-zinc-300 bg-white hover:bg-zinc-50"}`}>{label} <span className="font-mono">{count[k]}</span></a>
        ))}
      </div>

      <Panel flush>
        {shown.length === 0 ? <p className="p-6 text-sm text-zinc-500">Nothing here.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="border-b border-zinc-100 text-[11px] uppercase tracking-wide text-zinc-500">
                {tab === "pending"
                  ? <tr><th className="px-5 py-3">Vehicle</th><th>Driver</th><th className="text-right">Last on file</th><th className="pl-6">Reminder</th><th className="px-5" /></tr>
                  : tab === "approved"
                    ? <tr><th className="px-5 py-3">Vehicle</th><th>Driver</th><th className="text-right">Reading</th><th className="pl-6">Approved</th></tr>
                    : <tr><th className="px-5 py-3">Vehicle</th><th>Driver</th><th className="text-right">Last on file</th><th className="text-right">Submitted</th><th className="text-right">Change</th><th className="pl-6">Status</th><th className="px-5" /></tr>}
              </thead>
              <tbody>
                {shown.map((r) => {
                  const held = r.verdict && r.verdict !== "normal";
                  const vehicle = <td className="px-5 py-4"><Plate>{r.registration_no}</Plate><span className="mt-1 block text-xs text-zinc-500">{car(r)}</span></td>;
                  const driver = <td className="py-4 pr-3">{r.holder_name ?? <span className="text-zinc-600">Unassigned</span>}</td>;
                  if (tab === "pending") return (
                    <tr key={r.id} className="border-b border-zinc-100 align-top last:border-0">
                      {vehicle}{driver}
                      <td className="py-4 pr-3 text-right"><span className="font-mono">{km(r.last_km)}</span>
                        <span className="mt-1 block text-xs">{r.stale_days !== null && r.stale_days > d.rules.staleDays ? <Pill tone="warn">{r.stale_days} days ago · stale</Pill> : <span className="text-zinc-500">{r.last_read_at ? dayMonth(r.last_read_at) : "no reading yet"}</span>}</span></td>
                      <td className="py-4 pl-6 pr-3 text-zinc-600">{r.status === "rejected" ? <Pill tone="warn">Sent back</Pill> : null}{r.last_link_at ? `Sent ${dayMonth(r.last_link_at)}` : r.wa_sent_at ? `Asked on WhatsApp ${dayMonth(r.wa_sent_at)}` : "Not sent"}
                        {r.link_expires_at && <span className="mt-1 block text-xs text-zinc-500">Link live · <RevokeButton slug={slug} submissionId={r.id} /></span>}</td>
                      <td className="px-5 py-4">{open && <div className="space-y-2"><RemindOne slug={slug} cycleId={id} submissionId={r.id} /><EnterReading slug={slug} submissionId={r.id} /></div>}</td>
                    </tr>);
                  if (tab === "approved") return (
                    <tr key={r.id} className="border-b border-zinc-100 last:border-0">{vehicle}{driver}
                      <td className="py-4 pr-3 text-right font-mono">{r.reading_km ? km(r.reading_km) : r.reading_hours ? "—" : "—"}{r.reading_hours && <span className="block text-xs text-zinc-500">{r.reading_hours} h</span>}</td><td className="py-4 pl-6 text-zinc-600">{r.reviewed_at ? dayMonth(r.reviewed_at) : "—"}{r.review_note && <span className="block text-xs text-zinc-500">{r.review_note}</span>}</td></tr>);
                  return (
                    <tr key={r.id} className={`border-b border-zinc-100 align-top last:border-0 ${held ? "bg-red-50" : ""}`}>
                      {vehicle}{driver}
                      <td className="py-4 pr-3 text-right"><span className="font-mono">{km(r.last_km)}</span><span className="mt-1 block text-xs text-zinc-500">{r.last_read_at ? dayMonth(r.last_read_at) : ""}</span></td>
                      <td className="py-4 pr-3 text-right"><span className="font-mono">{r.reading_km ? km(r.reading_km) : "—"}</span>{r.reading_hours && <span className="mt-1 block font-mono text-xs text-zinc-700">{r.reading_hours} h</span>}<span className="mt-1 block text-xs text-zinc-500">{r.submitted_at ? dayMonth(r.submitted_at) : ""}</span></td>
                      <td className="py-4 pr-3 text-right"><span className={`font-mono ${held ? "font-semibold text-red-700" : ""}`}>{r.change_km !== null ? `${r.change_km >= 0 ? "+" : ""}${Number(r.change_km).toLocaleString("en-US", { maximumFractionDigits: 1 })} km` : "—"}</span>
                        {r.km_per_day !== null && r.change_km !== null && r.change_km > 0 && <span className="mt-1 block text-xs text-zinc-500">{r.km_per_day} km a day</span>}</td>
                      <td className="py-4 pl-6 pr-3">{r.verdict === "lower" ? <Pill tone="bad">Lower than last</Pill> : r.verdict === "too_fast" ? <Pill tone="bad">Too far, too fast</Pill> : <Pill tone="info">Submitted</Pill>}
                        {r.note && <span className="mt-1 block text-xs text-zinc-500">{r.note}</span>}</td>
                      <td className="px-5 py-4 text-right">{open && !held && <ApproveOne slug={slug} submissionId={r.id} />}</td>
                    </tr>
                  );
                })}
                {open && (tab === "review" || tab === "held") && shown.filter((r) => r.verdict && r.verdict !== "normal").map((r) => (
                  <tr key={`${r.id}-hold`} className="border-b border-zinc-100 bg-red-50 last:border-0">
                    <td colSpan={7} className="px-5 pb-4 pt-0">
                      <p className="mb-2 text-sm text-red-800">{r.verdict === "lower"
                        ? `This reading is ${Math.abs(r.change_km ?? 0).toLocaleString("en-US")} km below the last one. It may be a typo, a new instrument cluster, or another vehicle.`
                        : `${Number(r.change_km).toLocaleString("en-US")} km in ${plural(r.days_between ?? 1, "day")}. The limit is ${d.rules.maxKmPerDay} km a day. Check for a mistyped digit.`}</p>
                      <HeldReview slug={slug} submissionId={r.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {open && tab === "review" && normalShown > 0 && (
          <footer className="flex flex-wrap items-center gap-3 border-t border-zinc-100 px-5 py-3 text-sm text-zinc-500">
            <span>Showing {shown.length} of {c.review}</span><span className="ml-auto"><ApproveAll slug={slug} cycleId={id} count={normalShown} /></span>
          </footer>
        )}
      </Panel>
      <p className="text-xs text-zinc-500">Drivers get a link by message and enter the reading on their phone. Typed readings are checked by you before they change a vehicle&apos;s odometer.</p>
    </main>
  );
}
