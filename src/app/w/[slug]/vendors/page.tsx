import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listVendors } from "@/lib/master/service";
import { Card } from "@/components/form";
import { VendorForm, VendorStatusButton } from "./form";

export default function VendorsPage({ params }: PageProps<"/w/[slug]/vendors">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const rows = await listVendors(getDriver(), m);
  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 p-4 text-zinc-900">
      <h1 className="text-xl font-semibold text-inherit">Vendors <span className="text-sm font-normal text-zinc-500">{rows.length}</span></h1>
      <Card title="Add a vendor"><VendorForm slug={slug} /></Card>
      <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-zinc-200 text-xs text-zinc-500"><tr><th className="p-3">Name</th><th className="p-3">Categories</th><th className="p-3">Contact</th><th className="p-3">Status</th><th className="p-3" /></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={5} className="p-6 text-center text-zinc-500">No vendors yet.</td></tr>}
            {rows.map((v) => (
              <tr key={v.id} className="border-b border-zinc-100 align-top last:border-0">
                <td className="p-3 font-medium">{v.name}</td>
                <td className="p-3">{v.categories.join(", ") || "—"}</td>
                <td className="p-3">{[v.contact, v.phone, v.email].filter(Boolean).join(" · ") || "—"}</td>
                <td className="p-3"><span className={`rounded-full px-2 py-0.5 text-xs ${v.status === "blocked" ? "bg-red-100 text-red-800" : "bg-green-100 text-green-800"}`}>{v.status}</span></td>
                <td className="space-y-2 p-3">
                  <details><summary className="cursor-pointer text-sky-800">Edit</summary><div className="mt-2 w-72 max-w-[80vw]"><VendorForm slug={slug} vendor={v} /></div></details>
                  <VendorStatusButton slug={slug} id={v.id} status={v.status === "blocked" ? "active" : "blocked"} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
