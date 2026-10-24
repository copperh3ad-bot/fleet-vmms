import type { Metadata } from "next";
import { SiteShell } from "@/components/site-shell";
import { ForgotForm } from "./form";

export const metadata: Metadata = { title: "Reset your password · Fleet OTG" };

export default function ForgotPasswordPage() {
  return (
    <SiteShell active="login">
      <div className="mx-auto max-w-md px-5 py-16">
        <h1 className="text-3xl font-semibold">Reset your password</h1>
        <p className="mt-3 text-zinc-700">Enter the email address you sign in with. We will send a link to choose a new password. Open the link in the same browser you use here, on this device.</p>
        <ForgotForm />
        <p className="mt-6 text-sm text-zinc-600"><a href="/login" className="font-medium text-brand underline">Back to sign in</a></p>
      </div>
    </SiteShell>
  );
}
