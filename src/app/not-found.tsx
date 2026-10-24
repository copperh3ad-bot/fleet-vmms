import Link from "next/link";

// Shown for any address that does not exist (or an organization the person is not a member of: the two look the same on purpose).
export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-3 p-6 text-zinc-900">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-zinc-600">The address is wrong, or the page has moved.</p>
      <p className="text-sm"><Link className="text-sky-800 underline" href="/">Back to the start</Link></p>
    </main>
  );
}
