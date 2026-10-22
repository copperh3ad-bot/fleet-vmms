import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listVehicles } from "@/lib/master/service";
import { getJobCard, listReasonCodes } from "@/lib/jobcards/service";
import { JobCardForm } from "../../form";

export default function EditJobCardPage({ params }: PageProps<"/w/[slug]/job-cards/[id]/edit">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [c, vehicles, reasons] = await Promise.all([getJobCard(driver, m, id), listVehicles(driver, m), listReasonCodes(driver, m)]);
  if (!c) notFound();
  if (!c.mine || !["draft", "returned_for_edit"].includes(c.status)) redirect(`/w/${slug}/job-cards/${id}`);
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold">Edit {c.job_no}</h1>
      <JobCardForm slug={slug} id={id} reasons={reasons}
        vehicles={vehicles.map((v) => ({ id: v.id, registration_no: v.registration_no, label: `${v.registration_no}${v.make ? ` · ${[v.make, v.model].filter(Boolean).join(" ")}` : ""}` }))}
        initial={{ vehicle_id: c.vehicle_id, reason_code_id: c.reason_code_id, category: c.category, priority: c.priority, odometer_km: c.odometer_km ?? "", needed_by: c.needed_by ?? "", cause_text: c.cause_text, description: c.description ?? "" }}
        initialLines={c.lines.map((l) => ({ kind: l.kind, description: l.description, qty: String(Number(l.qty)), unit_cost: String(Number(l.unit_cost)) }))} />
    </main>
  );
}
