"use client";

// Shown when a page fails while it is being built. The message is deliberately generic: error text can name tables or hosts,
// and never reaches the screen. The digest is a short code that matches the entry in the server log.
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-3 p-6 text-zinc-900">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-zinc-600">Try again. If it keeps happening, tell your administrator{error.digest ? ` and quote ${error.digest}` : ""}.</p>
      <p><button type="button" onClick={reset} className="h-10 rounded-md bg-sky-800 px-5 font-medium text-white">Try again</button></p>
    </main>
  );
}
