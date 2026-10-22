import { Suspense } from "react";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { signOut } from "@/app/login/actions";

export default function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<div className="h-12 border-b border-zinc-200" />}><Nav params={params} /></Suspense>
      {children}
    </div>
  );
}

async function Nav({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug);
  const perms = await permissionsOf(getDriver(), m);
  // Links are hidden when the role could not use them. The pages and actions check again; this is only tidiness.
  const links = [
    { href: `/w/${slug}`, label: "Home", show: true },
    { href: `/w/${slug}/vehicles`, label: "Vehicles", show: perms.has("vehicle.read") },
    { href: `/w/${slug}/employees`, label: "Employees", show: perms.has("employee.manage") },
    { href: `/w/${slug}/vendors`, label: "Vendors", show: perms.has("vendor.manage") },
  ].filter((l) => l.show);
  return (
    <header className="border-b border-zinc-200 bg-white text-zinc-900">
      <nav className="mx-auto flex max-w-6xl items-center gap-4 overflow-x-auto px-4 py-3 text-sm" aria-label="Workspace">
        <span className="font-semibold">{slug}</span>
        {links.map((l) => <a key={l.href} href={l.href} className="whitespace-nowrap text-sky-800 hover:underline">{l.label}</a>)}
        <form action={signOut} className="ml-auto"><button type="submit" className="text-zinc-600 underline">Sign out</button></form>
      </nav>
    </header>
  );
}
