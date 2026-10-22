import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listWorkspaces } from "@/lib/auth/can";
import { postLoginDestination } from "@/lib/auth/routing";
import { pendingInvitationsFor } from "@/lib/admin/service";
import { signOut } from "./login/actions";
import { AcceptButton } from "./accept-button";

export default function Home() {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><HomeInner /></Suspense>;
}

async function HomeInner() {
  const user = await requireUser();
  const driver = getDriver();
  const [spaces, invites] = await Promise.all([
    listWorkspaces(driver, user.id),
    pendingInvitationsFor(driver, { email: user.email, emailConfirmed: !!user.email_confirmed_at }),
  ]);
  const dest = invites.length === 0 ? postLoginDestination(spaces) : null;   // a waiting invitation is shown before going straight in
  if (dest) redirect(dest);
  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-4 p-6">
      {invites.length > 0 && (
        <section aria-labelledby="inv" className="space-y-2">
          <h2 id="inv" className="text-sm font-semibold">Invitations waiting for you</h2>
          <ul className="space-y-2">
            {invites.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-zinc-900">
                <span className="min-w-0 flex-1">Join <span className="font-medium">{i.workspace}</span></span>
                <AcceptButton invitationId={i.id} />
              </li>
            ))}
          </ul>
        </section>
      )}
      <h1 className="text-xl font-semibold">{spaces.length ? "Choose a workspace" : "No workspace yet"}</h1>
      {spaces.length === 0 && invites.length === 0 && <p className="text-sm text-zinc-600">You are signed in as {user.email}, but you have not been added to a workspace. Ask your administrator for an invitation.</p>}
      <ul className="space-y-2">
        {spaces.map((s) => (
          <li key={s.slug}><a className="block rounded-md border border-zinc-200 p-3 hover:bg-zinc-50" href={`/w/${s.slug}`}>{s.name} <span className="text-xs text-zinc-500">{s.role}</span></a></li>
        ))}
      </ul>
      <form action={signOut}><button className="text-sm text-sky-800 underline" type="submit">Sign out</button></form>
    </main>
  );
}
