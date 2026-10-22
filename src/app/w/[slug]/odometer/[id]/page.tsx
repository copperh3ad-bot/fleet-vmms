import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { getCycle } from "@/lib/odometer/service";
import { CloseButton, EnterReading, LinksPanel, RevokeButton, Review } from "../forms";

export default function CyclePage({ params }: PageProps<"/w/[slug]/odometer/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const monthName = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const km = (s: string) => Number(s).toLocaleString("en-US", { maximumFractionDigits: 1 });
const LABEL: Record<string, string> = { pending: "Waiting", submitted: "To review", approved: "Approved", rejected: "Rejected, needs a new reading" };

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug);
  const d = await getCycle(getDriver(), m, id);
  if (!d) notFound();
  const open = d.cycle.status === "open";
  const waiting = d.rows.filter((r) => ["pending", "rejected"].includes(r.status)).length;
  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 p-4 text-zinc-900">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold">{monthName(d.cycle.period)}</h1>
        <span className="text-sm text-zinc-600">due {d.cycle.due_on} · {open ? "open" : "closed"}</span>
        <a href={`/w/${slug}/odometer`} className="ml-auto text-sm text-sky-800 underline">All months</a>
      </div>
      {open && waiting > 0 && <section className="rounded-lg border border-zinc-200 bg-white p-4"><LinksPanel slug={slug} cycleId={id} waiting={waiting} /></section>}
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs text-zinc-500"><tr><th className="p-3">Vehicle</th><th className="p-3">Held by</th><th className="p-3 text-right">Now</th><th className="p-3 text-right">Sent</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead>
          <tbody>
            {d.rows.map((r) => (
              <tr key={r.id} className="border-b border-zinc-100 align-top last:border-0">
                <td className="p-3 font-medium">{r.registration_no}</td>
                <td className="p-3">{r.holder_name ?? <span className="text-zinc-400">Unassigned</span>}</td>
                <td className="p-3 text-right tabular-nums">{km(r.last_km)}</td>
                <td className="p-3 text-right tabular-nums">{r.reading_km ? km(r.reading_km) : "—"}</td>
                <td className="p-3">{LABEL[r.status] ?? r.status}{r.review_note && <span className="block text-xs text-zinc-500">{r.review_note}</span>}{r.note && r.status === "submitted" && <span className="block text-xs text-zinc-500">{r.note}</span>}</td>
                <td className="p-3">
                  {open && r.status === "submitted" && <Review slug={slug} submissionId={r.id} />}
                  {open && ["pending", "rejected"].includes(r.status) && (
                    <div className="space-y-1">
                      <EnterReading slug={slug} submissionId={r.id} />
                      {r.link_expires_at && <p className="text-xs text-zinc-500">Link live until {new Date(r.link_expires_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC · <RevokeButton slug={slug} submissionId={r.id} /></p>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <CloseButton slug={slug} cycleId={id} />}
    </main>
  );
}
