import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listDepartments, listEmployeeOptions, listServiceTypes } from "@/lib/master/service";
import { loadCatalogExtras } from "@/lib/master/vehicle-names";
import { PageHeader, btnPrimary } from "@/components/ui";
import { AddVehicleForm } from "./form";

export default function NewVehiclePage({ params, searchParams }: PageProps<"/w/[slug]/vehicles/new">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const m = await requireMembership(slug, { fullScope: true });
  const [employees, serviceTypes, departments, extras] = await Promise.all([listEmployeeOptions(getDriver(), m), listServiceTypes(getDriver(), m), listDepartments(getDriver(), m), loadCatalogExtras(getDriver(), m.tenantId)]);
  const added = typeof sp.added === "string" ? sp.added.slice(0, 20) : "";
  const note = typeof sp.note === "string" ? sp.note.slice(0, 300) : "";
  return (
    <main className="space-y-1 p-6 text-zinc-900">
      <PageHeader title="Add a vehicle" sub="Takes about three minutes. Fields marked * are needed to save."
        actions={<a href={`/w/${slug}/vehicles/import`} className={btnPrimary}>Import data</a>} />
      {added && <p role="status" className="mt-4 rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-900">{added} saved. Add the next one below.{note && <span className="block text-amber-800">{note}</span>}</p>}
      <AddVehicleForm slug={slug} currency={m.currency} employees={employees} departments={departments} serviceTypes={serviceTypes} extras={extras} year={new Date().getFullYear()} />
    </main>
  );
}
