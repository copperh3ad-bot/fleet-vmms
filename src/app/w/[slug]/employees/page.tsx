import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listEmployees } from "@/lib/master/service";
import { Card } from "@/components/form";
import { EmployeeForm } from "./form";

export default function EmployeesPage({ params }: PageProps<"/w/[slug]/employees">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const rows = await listEmployees(getDriver(), m);
  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold text-inherit">Employees <span className="text-sm font-normal text-zinc-500">{rows.length}</span></h1>
      <Card title="Add an employee"><EmployeeForm slug={slug} /></Card>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs text-zinc-500"><tr><th className="p-3">Name</th><th className="p-3">No.</th><th className="p-3">Department</th><th className="p-3">Vehicles</th><th className="p-3">Login</th><th className="p-3" /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6} className="p-6 text-center text-zinc-500">No employees yet.</td></tr>}
            {rows.map((e) => (
              <tr key={e.id} className="border-b border-zinc-100 align-top last:border-0">
                <td className="p-3 font-medium">{e.full_name}{!e.active && <span className="ml-2 rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-normal">inactive</span>}</td>
                <td className="p-3">{e.employee_no ?? "—"}</td><td className="p-3">{e.department ?? "—"}</td>
                <td className="p-3 tabular-nums">{e.vehicles}</td><td className="p-3">{e.has_login ? "Yes" : "No"}</td>
                <td className="p-3"><details><summary className="cursor-pointer text-sky-800">Edit</summary><div className="mt-2 w-72 max-w-[80vw]"><EmployeeForm slug={slug} employee={e} /></div></details></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
