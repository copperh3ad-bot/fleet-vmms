import { Suspense, type ReactNode } from "react";
import type { Metadata } from "next";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listClaimsForOperator } from "@/lib/billing/operator";
import { countNewContactMessages } from "@/lib/contact";
import { NavLink } from "@/components/shell/nav-link";
import { signOut } from "@/app/login/actions";
import { LogoMark } from "@/components/brand";

export const metadata: Metadata = { title: "Operator · Fleet OTG", robots: { index: false, follow: false } };

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Shell>{children}</Shell></Suspense>;
}

async function Shell({ children }: { children: ReactNode }) {
  const user = await requireOperator();
  const [claims, unread] = await Promise.all([listClaimsForOperator(getDriver(), user.id), countNewContactMessages(getDriver(), user.id).catch(() => 0)]);
  const pending = claims.length;
  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-side text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3 text-sm">
          <span className="flex items-center gap-2 font-semibold"><LogoMark height={24} /> <span className="font-normal text-[#9FB2BE]">· Operator</span></span>
          <nav className="flex gap-1" aria-label="Operator">
            <NavLink href="/admin" label="Organizations" exact />
            <NavLink href="/admin/payments" label={pending ? `Payments (${pending})` : "Payments"} />
            <NavLink href="/admin/messages" label={unread ? `Messages (${unread})` : "Messages"} />
            <NavLink href="/admin/tax" label="Tax" />
            <NavLink href="/admin/accounting" label="Accounting" />
            <NavLink href="/admin/rates" label="Rates" />
            <NavLink href="/admin/settings" label="Settings" />
          </nav>
          <span className="ml-auto text-[#9FB2BE]">{user.email}</span>
          <form action={signOut}><button type="submit" className="underline">Sign out</button></form>
        </div>
      </header>
      <div className="flex-1">{children}</div>
    </div>
  );
}
