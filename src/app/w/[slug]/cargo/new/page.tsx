import { Suspense } from "react";
import { forbidden } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { fleetOpsOn, FLEET_OPS_MESSAGE } from "@/lib/billing/fleet-ops";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { PageHeader, Panel } from "@/components/ui";
import { CargoRequestForm } from "./form";

export default function NewCargoPage({ params }: { params: Promise<{ slug: string }> }) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  if (!(await fleetOpsOn(getDriver(), m.tenantId))) return <main className="p-6 text-sm text-zinc-600">{FLEET_OPS_MESSAGE}</main>;
  if (!(await permissionsOf(getDriver(), m)).has("cargo.request")) forbidden();
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader crumb={<a href={`/w/${slug}/cargo`} className="text-sky-800 hover:underline">Cargo</a>} title="Ask for a cargo pick-up and delivery" sub="The fleet office confirms it with you, and may send it with one of its own vehicles or a logistics provider." />
      <Panel><CargoRequestForm slug={slug} /></Panel>
    </main>
  );
}
