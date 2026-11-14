import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { getDriver } from "@/lib/db";
import { listWorkspaces } from "@/lib/auth/can";
import { postLoginDestination } from "@/lib/auth/routing";
import { pendingInvitationsFor } from "@/lib/admin/service";
import { pendingSignupFor } from "@/lib/orgs/signup";
import { waitingRequestsFor } from "@/lib/orgs/join";
import { loadOffer } from "@/lib/billing/offer";
import { signOut } from "./login/actions";
import { AcceptButton } from "./accept-button";
import { Landing, PriceBox } from "./landing";

export default function Home() {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><HomeInner /></Suspense>;
}

/** Signed out: the landing page. Signed in: straight into your workspace, or a short list to choose from. */
async function HomeInner() {
  await connection();
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  const driver = getDriver();
  const user = data.user;
  if (!user) return <Landing price={<PriceBox offer={await loadOffer(driver).catch(() => null)} />} />;

  const [spaces, invites, waiting, asked] = await Promise.all([
    listWorkspaces(driver, user.id),
    pendingInvitationsFor(driver, { email: user.email, emailConfirmed: !!user.email_confirmed_at }),
    user.email && user.email_confirmed_at ? pendingSignupFor(driver, user.email) : Promise.resolve(null),
    user.email && user.email_confirmed_at ? waitingRequestsFor(driver, user.email).catch(() => []) : Promise.resolve([]),
  ]);
  if (waiting && spaces.length === 0) redirect("/setup");                 // they signed up and confirmed: build the workspace
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
                <AcceptButton invitationId={i.id} needsLicence={i.needsLicence} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {asked.length > 0 && (
        <section aria-labelledby="asked" className="space-y-2">
          <h2 id="asked" className="text-sm font-semibold">Waiting for approval</h2>
          <ul className="space-y-2">
            {asked.map((a) => <li key={a.company} className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-zinc-900">Your request to join <span className="font-medium">{a.company}</span> is waiting for its administrator. When it is approved, an invitation appears here.</li>)}
          </ul>
        </section>
      )}
      <h1 className="text-xl font-semibold">{spaces.length ? "Choose a workspace" : "No workspace yet"}</h1>
      {spaces.length === 0 && invites.length === 0 && (
        <div className="space-y-3 text-sm text-zinc-600">
          <p>You are signed in as {user.email}, but you have not been added to a workspace.</p>
          <p className="rounded-md border border-sky-200 bg-sky-50 p-3 text-zinc-800">Already asked to join with a company code? Your request reaches the administrator only after you type the 6-digit code we sent to your WhatsApp number. <a className="font-medium text-brand underline" href="/join/sent">Enter the code</a> (in the browser you asked from), or <a className="font-medium text-brand underline" href="/join">ask again</a> if no code came. Once the administrator approves, the invitation appears here.</p>
          <p>If your company already uses Fleet OTG, ask your administrator for an invitation or for the company code, then <a className="font-medium text-brand underline" href="/join">ask to join</a>. To use it for your own company, <a className="font-medium text-brand underline" href="/setup">start a free trial</a>.</p>
        </div>
      )}
      <ul className="space-y-2">
        {spaces.map((s) => (
          <li key={s.slug}><a className="block rounded-md border border-zinc-200 p-3 hover:bg-zinc-50" href={`/w/${s.slug}`}>{s.name} <span className="text-xs text-zinc-500">{s.role}</span></a></li>
        ))}
      </ul>
      {spaces.length > 0 && <p className="text-sm text-zinc-500">Need another workspace for a different company? <a className="underline" href="/setup">Start a free trial</a>.</p>}
      <form action={signOut}><button className="text-sm text-sky-800 underline" type="submit">Sign out</button></form>
    </main>
  );
}
