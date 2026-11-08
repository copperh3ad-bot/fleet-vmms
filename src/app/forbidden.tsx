import Link from "next/link";

export const metadata = { robots: { index: false, follow: false } };

// Shown when a signed-in person opens a page their role has no permission for. (Hiding the link is only tidiness;
// the permission is checked on every page and action, and this is what they see when it fails.)
export default function Forbidden() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-3 p-6 text-zinc-900">
      <h1 className="text-xl font-semibold">You do not have access to this page</h1>
      <p className="text-sm text-zinc-600">Your role does not include it. If you think it should, ask your administrator.</p>
      <p className="text-sm"><Link className="text-sky-800 underline" href="/">Back to the start</Link></p>
    </main>
  );
}
