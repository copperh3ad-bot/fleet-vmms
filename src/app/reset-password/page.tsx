import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { ResetForm } from "./form";

export const metadata: Metadata = { title: "Choose a new password · Fleet OTG", robots: { index: false, follow: false } };

export default function ResetPasswordPage() {
  return (
    <SiteShell active="login">
      <div className="mx-auto max-w-md px-5 py-16">
        <h1 className="text-3xl font-semibold">Choose a new password</h1>
        <p className="mt-3 text-zinc-700">Use at least 10 characters. You will stay signed in on this device, and be signed out everywhere else.</p>
        <ResetForm />
      </div>
    </SiteShell>
  );
}
