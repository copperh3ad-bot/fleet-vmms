import { dmy } from "@/lib/format/date";
import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listEmployees } from "@/lib/master/service";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { EmployeeForm } from "./form";
import { LicenceForm } from "./licence-form";
import { listLicences } from "@/lib/compliance/licences";

export default function EmployeesPage({ params }: PageProps<"/w/[slug]/employees">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug, { fullScope: true });
  const [rows, licences] = await Promise.all([listEmployees(getDriver(), m), listLicences(getDriver(), m).catch(() => [])]);
  const licenceOf = new Map(licences.map((l) => [l.employee_id, l]));
  const today = new Date().toISOString().slice(0, 10);
  const licenceTone = (iso: string) => { const days = Math.round((Date.parse(iso) - Date.parse(today)) / 86400000); return days < 0 ? ("bad" as const) : days <= 30 ? ("warn" as const) : ("ok" as const); };
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Employees" sub={`${rows.length} ${rows.length === 1 ? "employee" : "employees"} on record. New employees are added with an invitation on the Users page.`} />
      <div>
        <Panel title="People" flush>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Name</th><th>No.</th><th>Department</th><th className="text-right">Vehicles</th><th>Login</th><th>Licence</th><th /></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={7} className="p-6 text-center text-zinc-500">No employees yet.</td></tr>}
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-zinc-100 align-top">
                  <td className="px-5 py-3 font-medium">{e.full_name}{!e.active && <span className="ml-2"><Pill>Inactive</Pill></span>}</td>
                  <td className="py-3">{e.employee_no ?? "—"}</td><td className="py-3">{e.department ?? "—"}</td>
                  <td className="py-3 text-right font-mono">{e.vehicles}</td><td className="py-3">{e.has_login ? <Pill tone="ok">Yes</Pill> : "No"}</td>
                  <td className="py-3">{licenceOf.get(e.id) ? <Pill tone={licenceTone(licenceOf.get(e.id)!.expires_on)}>{dmy(licenceOf.get(e.id)!.expires_on)}</Pill> : <span className="text-zinc-400">None</span>}</td>
                  <td className="py-3 pr-5"><details><summary className="cursor-pointer text-sky-800">Edit</summary><div className="mt-2 w-72 max-w-[80vw]"><EmployeeForm slug={slug} employee={e} />
                    <h3 className="mb-2 mt-4 border-t border-zinc-100 pt-3 text-sm font-semibold">Driving licence</h3>
                    <LicenceForm slug={slug} employeeId={e.id} licence={licenceOf.get(e.id)} /></div></details></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Panel>
      </div>
    </main>
  );
}
