import { Suspense } from "react";
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { ResendForm } from "@/app/signup/check-email/resend";
import { getDriver } from "@/lib/db";
import { JOIN_REF_COOKIE, joinCodeState } from "@/lib/orgs/join";
import { CodeForm } from "./code-form";

export const metadata: Metadata = { title: "Request sent · Fleet OTG", robots: { index: false, follow: false } };

export default function JoinSentPage({ searchParams }: PageProps<"/join/sent">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner searchParams={searchParams} /></Suspense>;
}

/**
 * Where the person lands after asking to join (ADR-055). While a code is awaited it asks for it: the request is not seen by the administrator until it is typed. The browser's own
 * reference (a cookie set when the request was made) says which request this is, so the page reveals nothing to anyone else.
 */
async function Inner({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const existing = sp.existing === "1";
  const ref = (await cookies()).get(JOIN_REF_COOKIE)?.value ?? "";
  const waiting = ref ? await joinCodeState(getDriver(), ref).catch(() => null) : null;
  return (
    <SiteShell active="join">
      <div className="mx-auto max-w-lg px-5 py-16">
        <h1 className="text-3xl font-semibold">{waiting ? "One more step: type the code from WhatsApp" : "Request sent"}</h1>
        {waiting && <CodeForm company={waiting.company} phoneEnds={waiting.phoneEnds} />}
        {!waiting && <p className="mt-3 text-zinc-700">If you have typed the code we sent on WhatsApp, your administrator can now see your request and will choose what you can do. If you have not been asked for a code on this device, ask to join again from the join page.</p>}
        <p className="mt-3 text-zinc-700">{existing ? "You already have a login with this email, so just sign in." : "We also sent a confirmation link to your email."}</p>
        <ol className="mt-5 list-decimal space-y-1 pl-5 text-sm text-zinc-600">
          <li>Type the code from WhatsApp. Nothing happens to your request until you do.</li>
          {!existing && <li>Open the confirmation link in your email. Look in spam or junk too.</li>}
          <li>Sign in with your email and password.</li>
          <li>When the administrator approves you, an invitation appears on your home page after you sign in. Accept it and you are in. Until then it shows that your request is waiting.</li>
        </ol>
        <p className="mt-6"><a href="/login" className="rounded-md bg-brand px-5 py-3 font-semibold text-white">Sign in</a></p>
        {!existing && (
          <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="font-semibold">Send the confirmation email again</h2>
            <ResendForm />
          </div>
        )}
      </div>
    </SiteShell>
  );
}
