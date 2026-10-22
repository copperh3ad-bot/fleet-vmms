import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireMembership } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { withTenant } from "@/lib/db/tenant";

export default function WorkspaceHome({ params }: PageProps<"/w/[slug]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Workspace params={params} /></Suspense>;
}

async function Workspace({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  if (m.role === "vendor") redirect(`/w/${slug}/vendor`);   // vendors only have their own work list
  // Placeholder dashboard: proves the whole chain (login, membership, tenant schema, permissions) end to end.
  const info = await withTenant(getDriver(), m, async (q) => ({
    perms: (await q.query<{ permission_key: string }>("select permission_key from role_permissions where role_key = $1 order by 1", [m.role])).rows.length,
    vehicles: (await q.query<{ c: number }>("select count(*)::int c from vehicles")).rows[0].c,
  }));
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-6">
      <h1 className="text-xl font-semibold">{slug}</h1>
      <p className="text-sm text-zinc-600">Role: {m.role}. Permissions: {info.perms}. Vehicles: {info.vehicles}.</p>
      <p className="text-sm"><a className="text-sky-800 underline" href={`/w/${slug}/vehicles`}>Vehicles</a></p>
    </main>
  );
}
