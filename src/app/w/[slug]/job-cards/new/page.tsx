import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { listEmployeeOptions, listVehicles } from "@/lib/master/service";
import { listReasonCodes, listServiceTags } from "@/lib/jobcards/service";
import { PageHeader } from "@/components/ui";
import { JobCardForm } from "../form";
import { JobCardWizard } from "../wizard";

export default function NewJobCardPage({ params, searchParams }: PageProps<"/w/[slug]/job-cards/new">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const m = await requireMembership(slug);
  const driver = getDriver();
  const perms = await permissionsOf(driver, m);
  const [vehicles, reasons, people, serviceTags] = await Promise.all([
    listVehicles(driver, m), listReasonCodes(driver, m), perms.has("vehicle.write") ? listEmployeeOptions(driver, m) : Promise.resolve(undefined), listServiceTags(driver, m),
  ]);
  const vehicleOpts = vehicles.filter((v) => v.status !== "disposed").map((v) => ({ id: v.id, registration_no: v.registration_no, label: `${v.registration_no}${v.make ? ` · ${[v.make, v.model].filter(Boolean).join(" ")}` : ""}` }));
  const vehicle = typeof sp.vehicle === "string" ? sp.vehicle : "";
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader crumb={<><a className="underline" href={`/w/${slug}/job-cards`}>Job cards</a> / New</>} title="New job card" />
      <div className="md:hidden">
        <JobCardWizard slug={slug} reasons={reasons} vehicles={vehicleOpts} initial={vehicle ? { vehicle_id: vehicle } : undefined} />
      </div>
      <div className="hidden md:block">
        <JobCardForm slug={slug} reasons={reasons} people={people} serviceTags={serviceTags} vehicles={vehicleOpts} initial={vehicle ? { vehicle_id: vehicle } : undefined} />
      </div>
    </main>
  );
}
