import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { assignables, tripsEnabled } from "@/lib/trips/service";
import { PageHeader, Panel } from "@/components/ui";
import { depotNames } from "@/lib/depots/service";
import { TripRequestForm } from "./form";

export default function NewTripPage({ params }: PageProps<"/w/[slug]/trips/new">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const driver = getDriver();
  if (!(await tripsEnabled(driver, m))) return <main className="p-6 text-sm text-zinc-600">Trips are not switched on for this organization.</main>;
  const { vehicles } = await assignables(driver, m);
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Ask for a trip" sub="A manager approves it and assigns the vehicle and driver." />
      <Panel><TripRequestForm slug={slug} places={await depotNames(driver, m)} vehicles={vehicles.map((v): [string, string] => [v.id, `${v.registration_no}${v.label ? " · " + v.label : ""}`])} /></Panel>
    </main>
  );
}
