import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { ResendForm } from "./resend";

export const metadata: Metadata = { title: "Check your email · Fleet OTG" };

export default function CheckEmailPage() {
  return (
    <SiteShell active="signup">
      <div className="mx-auto max-w-lg px-5 py-16">
        <h1 className="text-3xl font-semibold">Check your email</h1>
        <p className="mt-3 text-zinc-700">We sent a confirmation link to the address you entered. Open it on this device, and we will set up your workspace.</p>
        <ul className="mt-5 list-disc space-y-1 pl-5 text-sm text-zinc-600">
          <li>It can take a minute. Look in spam or junk too.</li>
          <li>The link works once. If it has expired, ask for a new one below.</li>
          <li>If you opened it on a different device, just sign in there with your email and password.</li>
        </ul>
        <div className="mt-8 rounded-xl border border-zinc-200 bg-white p-5">
          <h2 className="font-semibold">Send it again</h2>
          <ResendForm />
        </div>
      </div>
    </SiteShell>
  );
}
