import { Suspense, type ReactNode } from "react";
import { requireMembership } from "@/lib/auth/session";
import { permissionsOf, whoAmI } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { unreadCount } from "@/lib/jobcards/service";
import { tripsEnabled } from "@/lib/trips/service";
import { fleetOpsOn } from "@/lib/billing/fleet-ops";
import { getNavCounts } from "@/lib/dashboard/service";
import { signOut } from "@/app/login/actions";
import { NavLink } from "@/components/shell/nav-link";
import { MobileMenu } from "@/components/shell/mobile-menu";
import { AccessBanner } from "@/components/shell/access-banner";
import { ChatVisitorInfo } from "@/components/support-chat";
import { chatVisitor } from "@/lib/chat";
import { tenantPlan } from "@/lib/billing/plans";
import { Logo, LogoMark } from "@/components/brand";

export default function WorkspaceLayout({ children, params }: LayoutProps<"/w/[slug]">) {
  return (
    <Suspense fallback={<div className="flex flex-1"><div className="hidden w-[232px] shrink-0 bg-side md:block" /><div className="flex-1" /></div>}>
      <Shell params={params}>{children}</Shell>
      <Suspense fallback={null}><ChatInfo params={params} /></Suspense>
    </Suspense>
  );
}

/** Who is asking, for the support chat: the company, workspace, plan and state. Never a person's name, email or phone. */
async function ChatInfo({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const m = await requireMembership(slug, { allowLocked: true });
  const plan = await tenantPlan(getDriver(), m.tenantId).catch(() => null);
  return <ChatVisitorInfo info={chatVisitor({ company: m.tenantName ?? slug, slug, plan: plan?.name ?? "—", state: m.billing?.state ?? "unknown" })} />;
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
          <div className="mx-auto flex max-w-6xl 2xl:max-w-[96rem] flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 text-sm">
            <span className="flex items-center gap-2 font-semibold"><LogoMark height={24} /> <span className="font-normal text-[#9FB2BE]">· {m.tenantName ?? slug}</span></span>
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
  const tripsOn = perms.has("trip.request") || perms.has("trip.approve") || perms.has("trip.dispatch") || perms.has("trip.read_all") || perms.has("invoice.verify") ? await tripsEnabled(driver, m).catch(() => false) : false;
  const fleetOps = await fleetOpsOn(driver, m.tenantId).catch(() => true);
  const to =(p: string) => `/w/${slug}${p}`;
  const has = (...p: string[]) => p.some((x) => perms.has(x));
  const sees = has("jobcard.create", "jobcard.read_own", "jobcard.read_all");
  const company = m.tenantName ?? slug;

  // Links are hidden when the role could not use them. Pages and actions check again; this is only tidiness.
  const main: Item[] = [
    { href: to(""), label: "Dashboard", show: true, exact: true },
    { href: to("/job-cards"), label: "Job cards", show: sees, badge: counts.approvals },
    { href: to("/vehicles"), label: "Vehicles", show: has("vehicle.read"), exclude: [to("/vehicles/new"), to("/vehicles/import")] },
    { href: to("/trips"), label: "Trips", show: tripsOn },
    { href: to("/cargo"), label: "Cargo", show: fleetOps && has("cargo.request", "cargo.handle", "cargo.read_all") },
    { href: to("/vehicle-requests"), label: "Vehicle requests", show: has("vreq.request", "vreq.decide", "vreq.read_all", "vreq.assign", "vreq.see_pool") },
    { href: to("/odometer"), label: "Odometer", show: has("odometer.review"), badge: counts.odometer },
    { href: to("/vendors"), label: "Vendors", show: has("vendor.manage") },
    { href: to("/policy"), label: "Maintenance policy", show: has("policy.read") },
    { href: to("/budgets"), label: "Budgets", show: has("budget.manage", "report.view") },
    { href: to("/compliance"), label: "Compliance", show: has("compliance.manage", "report.view") },
    { href: to("/vendor"), label: "My work", show: has("quotation.submit") },
  ];
  const money: Item[] = [
    { href: to("/reports/breaking"), label: "Why it keeps breaking", show: has("report.view") },
    { href: to("/reports"), label: "Reports", show: has("report.view"), exact: true },
    { href: to("/quotations"), label: "Quotations", show: has("jobcard.read_all") },
    { href: to("/invoices"), label: "Invoices", show: has("invoice.verify", "invoice.read") },
    { href: to("/accidents"), label: "Accidents and challans", show: has("compliance.manage", "report.view"), also: [to("/challans")] },
  ];
  const admin: Item[] = [
    { href: to("/users"), label: "Users and roles", show: has("admin.users"), badge: counts.joins },
    { href: to("/settings"), label: "Service rules", show: has("service.manage", "budget.manage", "admin.settings") },
    { href: to("/employees"), label: "Employees", show: has("employee.manage") },
    { href: to("/depots"), label: "Depots and places", show: has("depot.manage") },
    { href: to("/vehicles/new"), label: "Add a vehicle", show: has("vehicle.write") },
  ];
  // Someone limited to their own vehicle gets the dashboard and the job cards, nothing else (the pages say no as well).
  const ownOnly = m.vehicleScope === "own";
  const keep = (i: Item) => i.show && (!ownOnly || i.label === "Dashboard" || i.label === "Job cards" || i.label === "Trips" || i.label === "Vehicles");
  const groups: { title?: string; items: Item[] }[] = [
    { items: main.filter(keep) },
    { title: "Analysis and money", items: money.filter(keep) },
    { title: "Admin", items: admin.filter(keep) },
  ].filter((g) => g.items.length);
  const notices = sees || has("quotation.submit", "invoice.verify", "compliance.manage", "trip.request", "trip.approve", "trip.dispatch", "vreq.request", "vreq.decide", "cargo.request", "cargo.handle");

  // Workshops get the slimmer "vendor portal" bar from the design, not the full sidebar.
  if (m.role === "vendor") {
    return (
      <div className="flex flex-1 flex-col">
        <header className="bg-side text-white">
          <div className="mx-auto flex max-w-6xl 2xl:max-w-[96rem] flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 text-sm">
            <span className="flex items-center gap-2 font-semibold"><LogoMark height={24} /> <span className="font-normal text-[#9FB2BE]">· Vendor portal</span></span>
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
        <div aria-hidden className="hazard-bar" />
        <MobileMenu bar={<>
            <span className="flex items-center gap-3"><LogoMark height={30} /><span className="block text-xs text-[#9FB2BE]">{company}</span></span>
            <span className="rounded-md border border-white/25 px-3 py-1.5 text-sm">Menu{counts.approvals + counts.odometer + counts.joins > 0 ? <span className="ml-2 rounded-full bg-badge px-1.5 text-xs font-semibold text-side">{counts.approvals + counts.odometer + counts.joins}</span> : null}</span>
          
          </>}>{nav}{foot}</MobileMenu>
      </header>
      {/* desktop: the fixed 232px sidebar */}
      <aside className="side-bg hidden w-[232px] shrink-0 text-white md:block">
        <div className="sticky top-0 flex h-dvh flex-col gap-5 overflow-y-auto px-3 pb-5 pt-0">
          <div aria-hidden className="hazard-bar -mx-3" />
          <div className="px-3"><Logo height={44} /><p className="mt-2 text-xs text-[#9FB2BE]">{company}</p></div>
          <div className="flex-1">{nav}</div>
          {foot}
        </div>
      </aside>
      <div className="min-w-0 flex-1"><AccessBanner slug={slug} access={m.billing} />{children}</div>
    </div>
  );
}
