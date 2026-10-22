import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listEmployeeOptions, listVehicles } from "@/lib/master/service";
import { AccidentForm } from "./form";

export default function NewAccidentPage({ params, searchParams }: PageProps<"/w/[slug]/accidents/new">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} searchParams={searchParams} /></Suspense>;
}

async function Inner({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const m = await requireMembership(slug);
  const driver = getDriver();
  const [vehicles, people] = await Promise.all([listVehicles(driver, m), listEmployeeOptions(driver, m)]);
  const initial: Record<string, string> = {};
  if (typeof sp.vehicle === "string") initial.vehicle_id = sp.vehicle;
  if (typeof sp.job_card === "string") initial.job_card_id = sp.job_card;
  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold">Record an accident</h1>
      <AccidentForm slug={slug} initial={initial} vehicles={vehicles.map((v) => [v.id, v.registration_no])} people={people.map((p) => [p.id, p.full_name])} />
    </main>
  );
}
