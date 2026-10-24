import { Suspense } from "react";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { requireUser } from "@/lib/auth/session";
import { listWorkspaces } from "@/lib/auth/can";
import { getDriver } from "@/lib/db";
import { loadOffer } from "@/lib/billing/offer";
import { pendingSignupFor } from "@/lib/orgs/signup";
import { signOut } from "@/app/login/actions";
import { CreateOrganizationForm } from "./form";
import { SetupProgressView } from "./progress";

export const metadata: Metadata = { title: "Setting up · Fleet OTG" };

export default function SetupPage() {
  return <Suspense fallback={<SiteShell><p className="p-6 text-sm text-zinc-500">Loading</p></SiteShell>}><Inner /></Suspense>;
}

async function Inner() {
  const user = await requireUser();
  const driver = getDriver();
  if (!user.email_confirmed_at) {
    return (
      <SiteShell>
        <div className="mx-auto max-w-lg px-5 py-16">
          <h1 className="text-2xl font-semibold">Confirm your email first</h1>
          <p className="mt-3 text-zinc-700">We sent a link to {user.email}. Open it, then come back here. <a className="underline" href="/signup/check-email">Send it again</a>.</p>
          <form action={signOut} className="mt-6"><button className="text-sm underline" type="submit">Sign out</button></form>
        </div>
      </SiteShell>
    );
  }
  const waiting = user.email ? await pendingSignupFor(driver, user.email) : null;
  if (!waiting && (await listWorkspaces(driver, user.id)).length > 0) redirect("/");
  const offer = await loadOffer(driver).catch(() => null);
  return (
    <SiteShell>
      <div className="mx-auto max-w-lg px-5 py-14">
        {waiting ? (
          <>
            <h1 className="text-2xl font-semibold">Setting up {waiting.org_name}</h1>
            <p className="mt-2 mb-8 text-zinc-600">This takes about a minute. Please keep this page open.</p>
            <SetupProgressView />
          </>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">Start a workspace for your company</h1>
            <p className="mt-2 mb-8 text-zinc-600">You are signed in as {user.email}. {offer ? `Your ${offer.trialDays}-day free trial starts when the workspace is ready.` : ""}</p>
            {offer ? <CreateOrganizationForm contactName={String(user.user_metadata?.full_name ?? "")} trialDays={offer.trialDays} /> : <p className="text-zinc-700">Sign-up is not open yet. Please check back soon.</p>}
          </>
        )}
      </div>
    </SiteShell>
  );
}
