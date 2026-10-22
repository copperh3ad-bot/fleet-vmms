import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { listEmployeeOptions, listVehicles } from "@/lib/master/service";
import { listReasonCodes } from "@/lib/jobcards/service";
import { JobCardForm } from "../form";

export default function NewJobCardPage({ params, searchParams }: PageProps<"/w/[slug]/job-cards/new">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const m = await requireMembership(slug);
  const driver = getDriver();
  const perms = await permissionsOf(driver, m);
  const [vehicles, reasons, people] = await Promise.all([
    listVehicles(driver, m), listReasonCodes(driver, m), perms.has("vehicle.write") ? listEmployeeOptions(driver, m) : Promise.resolve(undefined),
  ]);
  const vehicle = typeof sp.vehicle === "string" ? sp.vehicle : "";
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold">New job card</h1>
      <JobCardForm slug={slug} reasons={reasons} people={people}
        vehicles={vehicles.filter((v) => v.status !== "disposed").map((v) => ({ id: v.id, registration_no: v.registration_no, label: `${v.registration_no}${v.make ? ` · ${[v.make, v.model].filter(Boolean).join(" ")}` : ""}` }))}
        initial={vehicle ? { vehicle_id: vehicle } : undefined} />
    </main>
  );
}
