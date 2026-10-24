import { Suspense } from "react";
import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { ResendForm } from "@/app/signup/check-email/resend";

export const metadata: Metadata = { title: "Request sent · Fleet OTG" };

export default function JoinSentPage({ searchParams }: PageProps<"/join/sent">) {
  return <Suspense fallback={<SiteShell active="join"><p className="p-6 text-sm text-zinc-500">Loading</p></SiteShell>}><Inner searchParams={searchParams} /></Suspense>;
}

async function Inner({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const existing = sp.existing === "1";
  return (
    <SiteShell active="join">
      <div className="mx-auto max-w-lg px-5 py-16">
        <h1 className="text-3xl font-semibold">Request sent</h1>
        <p className="mt-3 text-zinc-700">Your administrator will see it and choose what you can do. {existing ? "You already have a login with this email, so just sign in." : "Meanwhile, we sent a confirmation link to your email."}</p>
        <ol className="mt-5 list-decimal space-y-1 pl-5 text-sm text-zinc-600">
          {!existing && <li>Open the confirmation link. Look in spam or junk too.</li>}
          <li>Sign in with your email and password.</li>
          <li>When the administrator approves you, an invitation appears on the first page. Accept it and you are in. Until then you will see that your request is waiting.</li>
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
