import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listNotifications } from "@/lib/jobcards/service";
import { PageHeader, Panel } from "@/components/ui";
import { MarkRead } from "./mark-read";

export default function NotificationsPage({ params }: PageProps<"/w/[slug]/notifications">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const TEXT: Record<string, string> = {
  "jobcard.submitted": "is waiting for your approval",
  "jobcard.approved": "was approved",
  "jobcard.rejected": "was rejected",
  "jobcard.returned_for_edit": "was sent back for edit",
  "jobcard.vendor_assigned": "was assigned to you. Please send a quotation",
  "quotation.received": "has a new quotation to review",
  "quotation.approved": "quotation was approved. A work order is ready",
  "quotation.rejected": "quotation was rejected. You can send a new one",
  "work.completed": "work is done",
  "invoice.submitted": "has an invoice to check",
  "invoice.verified": "invoice was checked",
  "invoice.returned": "invoice was returned to you",
  "document.expiring": "expires soon",
  "document.expired": "has expired",
};

/** Vendors have no job card page; their notices open their own list. */
const vendorKinds = new Set(["jobcard.vendor_assigned", "quotation.approved", "quotation.rejected", "invoice.verified", "invoice.returned"]);

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const rows = await listNotifications(getDriver(), m);
  const unread = rows.filter((r) => !r.read_at).length;
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Notifications" sub={unread ? `${unread} unread` : "All read"} actions={unread ? <MarkRead slug={slug} /> : undefined} />
      <Panel flush>
        {rows.length === 0 ? <p className="p-5 text-sm text-zinc-500">Nothing yet.</p> : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {rows.map((n) => (
              <li key={n.id} className={`flex flex-wrap items-baseline gap-x-2 px-5 py-3 ${n.read_at ? "text-zinc-600" : "font-medium"}`}>
                {!n.read_at && <span aria-label="Unread" className="mr-1 inline-block h-2 w-2 rounded-full bg-brand" />}
                <span>
                  {n.payload.job_card_id
                    ? <a className="text-sky-800 hover:underline" href={vendorKinds.has(n.kind) ? `/w/${slug}/vendor` : `/w/${slug}/job-cards/${n.payload.job_card_id}`}>{n.payload.job_no}</a>
                    : "Job card"} {TEXT[n.kind] ?? n.kind}
                </span>
                <span className="ml-auto text-xs font-normal text-zinc-500">{new Date(n.created_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" })} UTC</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </main>
  );
}
