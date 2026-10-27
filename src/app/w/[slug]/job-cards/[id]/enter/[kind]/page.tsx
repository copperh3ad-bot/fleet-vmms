import { Suspense } from "react";
import { notFound } from "next/navigation";
import Link from "next/link";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { getJobCard } from "@/lib/jobcards/service";
import { getJobFlow, listWorkshopEmails } from "@/lib/vendorflow/service";
import { Panel } from "@/components/ui";
import { EstimateForm } from "@/app/q/[token]/form";
import { InvoiceForm } from "@/app/q/[token]/invoice-form";
import { enterForWorkshopAction } from "../../../actions";

export const metadata = { title: "Enter what the workshop sent", robots: { index: false, follow: false } };

export default function EnterPage({ params, searchParams }: PageProps<"/w/[slug]/job-cards/[id]/enter/[kind]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

// Staff type in the figures from a workshop's emailed reply (ADR-033). The form is the one the workshop's own link shows; it is filed the same way.
async function Inner({ params, searchParams }: { params: Promise<{ slug: string; id: string; kind: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug, id, kind } = await params;
  if (kind !== "quotation" && kind !== "invoice") notFound();
  const sp = await searchParams;
  const emailId = typeof sp.email === "string" && /^[0-9a-f-]{36}$/.test(sp.email) ? sp.email : "";
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [c, perms] = await Promise.all([getJobCard(driver, m, id), permissionsOf(driver, m)]);
  if (!c || !(perms.has("jobcard.assign_vendor") || perms.has("quotation.approve") || (kind === "invoice" && perms.has("invoice.verify")))) notFound();
  const cur = m.currency || "PKR";
  const flow = await getJobFlow(driver, m, id);
  const approved = flow.quotations.find((q) => q.status === "approved");
  const emails = (await listWorkshopEmails(driver, m, id)).filter((e) => e.kind === kind && e.status === "new");
  const email = emails.find((e) => e.id === emailId) ?? emails[0];
  const submit = enterForWorkshopAction.bind(null, slug, id, kind, email?.id ?? "");
  const what = kind === "quotation" ? "estimate" : "invoice";
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <div>
        <Link href={`/w/${slug}/job-cards/${id}`} className="text-sm underline">Back to the job card</Link>
        <h1 className="mt-2 text-2xl font-semibold">Enter the {what} the workshop sent</h1>
        <p className="mt-1 text-sm text-zinc-600">Job card <span className="font-mono">{c.job_no}</span>. Type in the figures from the workshop&apos;s email and its attached file. The file is among this job card&apos;s files. Your name goes in the history.</p>
      </div>
      {email && (
        <Panel title="Their email">
          <div className="space-y-2 p-4 text-sm">
            <p><span className="text-zinc-500">From </span>{email.from_address}{!email.sender_matches && <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-amber-900">not the address on file for this workshop</span>}</p>
            {email.subject && <p className="font-medium">{email.subject}</p>}
            {email.body_text && <pre className="whitespace-pre-wrap font-sans text-zinc-700">{email.body_text}</pre>}
          </div>
        </Panel>
      )}
      <div className="max-w-md">
        {kind === "quotation"
          ? <EstimateForm submit={submit} currency={cur} doneText="Saved. The estimate is on the job card for a decision." />
          : <InvoiceForm submit={submit} currency={cur} approved={approved?.lines ?? []} doneText="Saved. The invoice is on the job card for checking." />}
      </div>
    </main>
  );
}
