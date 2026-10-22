import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { Card } from "@/components/form";
import { vendorGetRequest } from "@/lib/vendorflow/service";
import { QuotationForm } from "./form";

export default function QuotePage({ params }: PageProps<"/w/[slug]/vendor/jobs/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug);
  const r = await vendorGetRequest(getDriver(), m, id);
  if (!r) notFound();
  if (r.job_status !== "vendor_assigned") redirect(`/w/${slug}/vendor`);
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold">Quotation for {r.job_no}</h1>
      <Card title="The job">
        <p className="text-sm font-medium">{[r.registration_no, r.make, r.model, r.year].filter(Boolean).join(" · ")}</p>
        <p className="mt-2 whitespace-pre-wrap text-sm">{r.cause_text}</p>
        {r.description && <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">{r.description}</p>}
        <p className="mt-2 text-xs text-zinc-500 capitalize">Priority {r.priority}{r.needed_by ? ` · needed by ${r.needed_by}` : ""}{r.odometer_km ? ` · ${Number(r.odometer_km).toLocaleString("en-US")} km` : ""}</p>
      </Card>
      <QuotationForm slug={slug} jobId={id} />
    </main>
  );
}
