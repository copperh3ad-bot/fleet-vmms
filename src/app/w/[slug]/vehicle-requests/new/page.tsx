import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { employeesToChoose } from "@/lib/vehicle-requests/service";
import { PageHeader, Panel } from "@/components/ui";
import { VehicleRequestForm } from "./form";

export default function NewVehicleRequestPage({ params }: PageProps<"/w/[slug]/vehicle-requests/new">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const employees = await employeesToChoose(getDriver(), m);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader crumb={<a href={`/w/${slug}/vehicle-requests`} className="text-sky-800 hover:underline">Vehicle requests</a>} title="Ask for a vehicle" sub="An administrator or fleet manager gives a vehicle from the pool, or approves buying one." />
      <Panel><VehicleRequestForm slug={slug} today={today} employees={employees.map((e): [string, string] => [e.id, `${e.full_name}${e.employee_no ? " · " + e.employee_no : ""}`])} /></Panel>
    </main>
  );
}
