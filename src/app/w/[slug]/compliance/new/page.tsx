import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listVehicles } from "@/lib/master/service";
import { DOC_LABEL } from "@/lib/compliance/schemas";
import { DocumentForm } from "./form";

export default function NewDocumentPage({ params, searchParams }: PageProps<"/w/[slug]/compliance/new">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const m = await requireMembership(slug, { fullScope: true });
  const vehicles = (await listVehicles(getDriver(), m)).filter((v) => v.status !== "disposed");
  const initial: Record<string, string> = {};
  if (typeof sp.vehicle === "string") initial.vehicle_id = sp.vehicle;
  if (typeof sp.type === "string" && DOC_LABEL[sp.type]) initial.doc_type = sp.type;
  if (typeof sp.ref === "string") initial.reference = sp.ref.slice(0, 80);
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold">Add or renew a document</h1>
      <DocumentForm slug={slug} initial={initial} vehicles={vehicles.map((v) => [v.id, v.registration_no])} types={Object.entries(DOC_LABEL)} />
    </main>
  );
}
