import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listWorkspaces } from "@/lib/auth/can";
import { postLoginDestination } from "@/lib/auth/routing";
import { signOut } from "./login/actions";

export default function Home() {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><HomeInner /></Suspense>;
}

async function HomeInner() {
  const user = await requireUser();
  const spaces = await listWorkspaces(getDriver(), user.id);
  const dest = postLoginDestination(spaces);
  if (dest) redirect(dest);
  return (
    <main className="mx-auto w-full max-w-md flex-1 space-y-4 p-6">
      <h1 className="text-xl font-semibold">{spaces.length ? "Choose a workspace" : "No workspace yet"}</h1>
      {spaces.length === 0 && <p className="text-sm text-zinc-600">You are signed in as {user.email}, but you have not been added to a workspace. Ask your administrator for an invitation.</p>}
      <ul className="space-y-2">
        {spaces.map((s) => (
          <li key={s.slug}><a className="block rounded-md border border-zinc-200 p-3 hover:bg-zinc-50" href={`/w/${s.slug}`}>{s.name} <span className="text-xs text-zinc-500">{s.role}</span></a></li>
        ))}
      </ul>
      <form action={signOut}><button className="text-sm text-sky-800 underline" type="submit">Sign out</button></form>
    </main>
  );
}
