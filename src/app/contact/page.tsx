import { Suspense } from "react";
import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { getDriver } from "@/lib/db";
import { loadPlatformSettings } from "@/lib/billing/settings";
import { ContactForm } from "./form";

export const metadata: Metadata = {
  title: "Contact us · Fleet OTG",
  description: "Ask a question about Fleet OTG, get help with your account, or ask about a payment.",
};

export default function ContactPage() {
  return (
    <SiteShell active="contact">
      <div className="mx-auto grid max-w-5xl gap-10 px-5 py-12 md:grid-cols-[1.4fr_1fr]">
        <div>
          <h1 className="text-3xl font-semibold">Contact us</h1>
          <p className="mt-3 text-zinc-700">Questions before you sign up, help with your account, or a payment to check: write to us here. We read every message.</p>
          <div className="mt-8"><ContactForm /></div>
        </div>
        <aside className="space-y-5 text-sm text-zinc-700" aria-label="Other ways to reach us">
          <Suspense fallback={null}><Direct /></Suspense>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="font-semibold text-zinc-900">Already a customer?</h2>
            <p className="mt-1">Billing questions are quickest from inside your workspace, where your payment reference and invoices are. <a href="/login" className="font-medium text-brand underline">Sign in</a>.</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="font-semibold text-zinc-900">Lost your password?</h2>
            <p className="mt-1"><a href="/forgot-password" className="font-medium text-brand underline">Reset it yourself</a> in a minute, with the email you sign in with.</p>
          </div>
          <div className="rounded-xl border border-zinc-200 bg-white p-5">
            <h2 className="font-semibold text-zinc-900">Not sure it fits?</h2>
            <p className="mt-1">The <a href="/pricing" className="font-medium text-brand underline">pricing page</a> and the <a href="/about" className="font-medium text-brand underline">about page</a> answer most first questions.</p>
          </div>
        </aside>
      </div>
    </SiteShell>
  );
}

// The email the owner has entered in the operator settings. Shown only when it is set; nothing is made up.
async function Direct() {
  const email = (await loadPlatformSettings(getDriver()).catch(() => ({} as Record<string, string>))).support_email?.trim();
  if (!email) return null;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5">
      <h2 className="font-semibold text-zinc-900">Write to us directly</h2>
      <p className="mt-1"><a href={`mailto:${email}`} className="font-medium text-brand underline">{email}</a></p>
    </div>
  );
}
