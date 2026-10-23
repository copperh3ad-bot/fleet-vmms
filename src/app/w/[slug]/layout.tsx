import { Suspense, type ReactNode } from "react";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf, whoAmI } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { unreadCount } from "@/lib/jobcards/service";
import { getNavCounts } from "@/lib/dashboard/service";
import { signOut } from "@/app/login/actions";
import { NavLink } from "@/components/shell/nav-link";
import { AccessBanner } from "@/components/shell/access-banner";

export default function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  return (
    <Suspense fallback={<div className="flex flex-1"><div className="hidden w-[232px] shrink-0 bg-side md:block" /><div className="flex-1" /></div>}>
      <Shell params={params}>{children}</Shell>
    </Suspense>
  );
}

type Item = { href: string; label: string; show: boolean; badge?: number; exact?: boolean; exclude?: string[]; also?: string[] };

async function Shell({ params, children }: { params: Promise<{ slug: string }>; children: ReactNode }) {
  const { slug } = await params;
  const m = await requireMembership(slug, { allowLocked: true });   // the billing page lives inside this layout; every other page stops a locked organization itself
  const driver = getDriver();
  if (m.billing && !m.billing.full) {
    const who = await whoAmI(driver, m);
    return (
      <div className="flex flex-1 flex-col">
        <header className="bg-side text-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 text-sm">
            <span className="font-semibold">Fleet VMMS <span className="font-normal text-[#9FB2BE]">· {m.tenantName ?? slug}</span></span>
            <nav className="flex gap-1" aria-label="Locked workspace"><NavLink href={`/w/${slug}/billing`} label="Billing" /></nav>
            <span className="ml-auto text-[#9FB2BE]">{who.name}</span>
            <form action={signOut}><button type="submit" className="underline">Sign out</button></form>
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </div>
    );
  }
  const [perms, me, unread, counts] = await Promise.all([permissionsOf(driver, m), whoAmI(driver, m), unreadCount(driver, m), getNavCounts(driver, m)]);
  const to = (p: string) => `/w/${slug}${p}`;
  const has = (...p: string[]) => p.some((x) => perms.has(x));
  const sees = has("jobcard.create", "jobcard.read_own", "jobcard.read_all");
  const company = m.tenantName ?? slug;

  // Links are hidden when the role could not use them. Pages and actions check again; this is only tidiness.
  const main: Item[] = [
    { href: to(""), label: "Dashboard", show: true, exact: true },
    { href: to("/job-cards"), label: "Job cards", show: sees, badge: counts.approvals },
    { href: to("/vehicles"), label: "Vehicles", show: has("vehicle.read"), exclude: [to("/vehicles/new"), to("/vehicles/import")] },
    { href: to("/odometer"), label: "Odometer", show: has("odometer.review"), badge: counts.odometer },
    { href: to("/vendors"), label: "Vendors", show: has("vendor.manage") },
    { href: to("/budgets"), label: "Budgets", show: has("budget.manage", "report.view") },
    { href: to("/compliance"), label: "Compliance", show: has("compliance.manage", "report.view") },
    { href: to("/vendor"), label: "My work", show: has("quotation.submit") },
  ];
  const money: Item[] = [
    { href: to("/reports/breaking"), label: "Why it keeps breaking", show: has("report.view") },
    { href: to("/reports"), label: "Reports", show: has("report.view"), exact: true },
    { href: to("/invoices"), label: "Invoices", show: has("invoice.verify") },
    { href: to("/accidents"), label: "Accidents and challans", show: has("compliance.manage", "report.view"), also: [to("/challans")] },
  ];
  const admin: Item[] = [
    { href: to("/users"), label: "Users and roles", show: has("admin.users") },
    { href: to("/settings"), label: "Service rules", show: has("service.manage", "budget.manage", "admin.settings") },
    { href: to("/employees"), label: "Employees", show: has("employee.manage") },
    { href: to("/vehicles/new"), label: "Add a vehicle", show: has("vehicle.write") },
  ];
  const groups: { title?: string; items: Item[] }[] = [
    { items: main.filter((i) => i.show) },
    { title: "Analysis and money", items: money.filter((i) => i.show) },
    { title: "Admin", items: admin.filter((i) => i.show) },
  ].filter((g) => g.items.length);
  const notices = sees || has("quotation.submit", "invoice.verify", "compliance.manage");

  // Workshops get the slimmer "vendor portal" bar from the design, not the full sidebar.
  if (m.role === "vendor") {
    return (
      <div className="flex flex-1 flex-col">
        <header className="bg-side text-white">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 text-sm">
            <span className="font-semibold">Fleet VMMS <span className="font-normal text-[#9FB2BE]">· Vendor portal</span></span>
            <nav className="flex gap-1" aria-label="Workshop">
              <NavLink href={to("/vendor")} label="My work" />
              <NavLink href={to("/notifications")} label={unread ? `Notifications (${unread})` : "Notifications"} />
            </nav>
            <span className="ml-auto text-[#9FB2BE]">{company} · {me.name}</span>
            <form action={signOut}><button type="submit" className="underline">Sign out</button></form>
          </div>
        </header>
        <div className="flex-1"><AccessBanner slug={slug} access={m.billing} />{children}</div>
      </div>
    );
  }

  const nav = (
    <nav aria-label="Workspace" className="space-y-5">
      {groups.map((g, i) => (
        <div key={i} className="space-y-0.5">
          {g.title && <p className="px-3 pb-1 pt-1 text-[11px] font-medium uppercase tracking-[0.08em] text-[#7E93A1]">{g.title}</p>}
          {g.items.map((it) => <NavLink key={it.href} href={it.href} label={it.label} badge={it.badge} exact={it.exact} exclude={it.exclude} also={it.also} />)}
        </div>
      ))}
    </nav>
  );
  const foot = (
    <div className="space-y-2 border-t border-white/10 pt-3 text-xs text-[#9FB2BE]">
      {notices && <NavLink href={to("/notifications")} label="Notifications" badge={unread} />}
      <p className="px-3 text-sm text-white">{me.name}</p>
      <p className="px-3">{me.roleName}</p>
      <form action={signOut} className="px-3"><button type="submit" className="underline hover:text-white">Sign out</button></form>
    </div>
  );

  return (
    <div className="flex flex-1 flex-col md:flex-row">
      {/* phone and tablet: a bar with the menu folded away */}
      <header className="bg-side text-white md:hidden">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3">
            <span><span className="block text-[17px] font-semibold leading-tight">Fleet VMMS</span><span className="block text-xs text-[#9FB2BE]">{company}</span></span>
            <span className="rounded-md border border-white/25 px-3 py-1.5 text-sm">Menu{counts.approvals + counts.odometer > 0 ? <span className="ml-2 rounded-full bg-badge px-1.5 text-xs font-semibold text-side">{counts.approvals + counts.odometer}</span> : null}</span>
          </summary>
          <div className="space-y-4 px-3 pb-4">{nav}{foot}</div>
        </details>
      </header>
      {/* desktop: the fixed 232px sidebar */}
      <aside className="hidden w-[232px] shrink-0 bg-side text-white md:block">
        <div className="sticky top-0 flex h-screen flex-col gap-5 overflow-y-auto px-3 py-5">
          <div className="px-3"><p className="text-[17px] font-semibold leading-tight">Fleet VMMS</p><p className="mt-0.5 text-xs text-[#9FB2BE]">{company}</p></div>
          <div className="flex-1">{nav}</div>
          {foot}
        </div>
      </aside>
      <div className="min-w-0 flex-1"><AccessBanner slug={slug} access={m.billing} />{children}</div>
    </div>
  );
}
