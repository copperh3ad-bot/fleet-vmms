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
import { aiOffered, getAiAction } from "@/lib/ai/service";
import { ReadWithAi } from "./read-ai";

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
  // The AI's reading (ADR-034): offered only when the organization has switched it on and the reply brought a file. It makes a draft for the form below;
  // the person checks every figure and saves, exactly as when typing it in.
  const draftId = typeof sp.draft === "string" && /^[0-9a-f-]{36}$/.test(sp.draft) ? sp.draft : "";
  const ai = draftId ? await getAiAction(driver, m, id, draftId) : null;
  const usable = ai && ai.status === "ok" && ai.outcome === "pending" ? ai : null;
  const canRead = !!email && email.file_count > 0 && (await aiOffered(driver, m));
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
      {canRead && <div className="max-w-md"><ReadWithAi slug={slug} jobId={id} kind={kind} emailId={email!.id} again={!!ai} /></div>}
      {usable?.draft && (
        <div role="note" className="max-w-md space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Filled in by AI from the attached file. It can be wrong.</p>
          <p>Check every line, quantity, price and the tax against the file before you save. Nothing is saved until you press the button, and the job card&apos;s history will say it was read by AI and checked by you.</p>
          {usable.draft.warnings.length > 0 && <ul className="list-disc space-y-1 pl-5">{usable.draft.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
        </div>
      )}
      {ai && !usable && ai.status !== "ok" && (
        <p role="note" className="max-w-md rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">The AI could not read the file: {ai.reason} Type the figures in from the file below.</p>
      )}
      <div className="max-w-md" key={usable?.id ?? "blank"}>
        {kind === "quotation"
          ? <EstimateForm submit={submit} currency={cur} doneText="Saved. The estimate is on the job card for a decision." draft={usable?.draft ?? null} aiActionId={usable?.id ?? ""} />
          : <InvoiceForm submit={submit} currency={cur} approved={approved?.lines ?? []} doneText="Saved. The invoice is on the job card for checking." draft={usable?.draft ?? null} aiActionId={usable?.id ?? ""} />}
      </div>
    </main>
  );
}
