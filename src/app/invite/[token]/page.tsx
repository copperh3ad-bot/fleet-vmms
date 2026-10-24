import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import Link from "next/link";
import { getDriver } from "@/lib/db";
import { allowShared } from "@/lib/rate-limit";
import { clientIp } from "@/lib/client-ip";
import { previewInvitation } from "@/lib/admin/service";
import { CreateAccountForm } from "./form";

export const metadata: Metadata = { title: "Your invitation", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default function InvitePage({ params }: PageProps<"/invite/[token]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

async function Inner({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  const driver = getDriver();
  const invite = (await allowShared(driver, `invite-view-ip:${await clientIp()}`, 60, 600)) ? await previewInvitation(driver, token) : null;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-4 p-6 text-zinc-900">
      {invite ? (
        <>
          <div>
            <p className="text-sm text-zinc-600">You are invited to</p>
            <h1 className="text-2xl font-semibold">{invite.workspace}</h1>
            <p className="mt-1 text-sm text-zinc-600">Hello {invite.full_name}. {invite.reset ? "Choose a new password to sign in again." : invite.email ? "Create your account to join." : "Choose a password to join."}</p>
          </div>
          <CreateAccountForm token={token} email={invite.email} username={invite.username} reset={invite.reset} />
          <p className="text-sm text-zinc-600">{invite.email ? "Already have an account with this email? " : "Already have an account? "}<Link className="text-sky-800 underline" href="/login">Sign in</Link>{invite.email ? ", and the invitation will be waiting on the first page." : "."}</p>
        </>
      ) : (
        <p role="status" className="rounded-lg border border-zinc-200 bg-white p-4 text-sm">This invitation is not working. Ask your administrator for a new one.</p>
      )}
    </main>
  );
}
