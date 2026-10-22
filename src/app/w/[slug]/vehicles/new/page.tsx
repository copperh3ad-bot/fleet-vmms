import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listEmployeeOptions, listServiceTypes } from "@/lib/master/service";
import { AddVehicleForm } from "./form";

export default function NewVehiclePage({ params }: PageProps<"/w/[slug]/vehicles/new">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const [employees, serviceTypes] = await Promise.all([listEmployeeOptions(getDriver(), m), listServiceTypes(getDriver(), m)]);
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">Add a vehicle</h1>
      <AddVehicleForm slug={slug} employees={employees} serviceTypes={serviceTypes} />
    </main>
  );
}
