import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listEmployees } from "@/lib/master/service";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { EmployeeForm } from "./form";

export default function EmployeesPage({ params }: PageProps<"/w/[slug]/employees">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug, { fullScope: true });
  const rows = await listEmployees(getDriver(), m);
  return (
    <main className="space-y-5 p-6 text-zinc-900">
      <PageHeader title="Employees" sub={`${rows.length} ${rows.length === 1 ? "employee" : "employees"} on record`} />
      <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
        <Panel title="People" flush>
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Name</th><th>No.</th><th>Department</th><th className="text-right">Vehicles</th><th>Login</th><th /></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-zinc-500">No employees yet.</td></tr>}
              {rows.map((e) => (
                <tr key={e.id} className="border-t border-zinc-100 align-top">
                  <td className="px-5 py-3 font-medium">{e.full_name}{!e.active && <span className="ml-2"><Pill>Inactive</Pill></span>}</td>
                  <td className="py-3">{e.employee_no ?? "—"}</td><td className="py-3">{e.department ?? "—"}</td>
                  <td className="py-3 text-right font-mono">{e.vehicles}</td><td className="py-3">{e.has_login ? <Pill tone="ok">Yes</Pill> : "No"}</td>
                  <td className="py-3 pr-5"><details><summary className="cursor-pointer text-sky-800">Edit</summary><div className="mt-2 w-72 max-w-[80vw]"><EmployeeForm slug={slug} employee={e} /></div></details></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </Panel>
        <Panel title="Add an employee"><EmployeeForm slug={slug} /></Panel>
      </div>
    </main>
  );
}
