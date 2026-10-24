"use client";

// The last resort: the page frame itself failed, so this carries its own html and body and uses no shared styles or components.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 420, margin: "20vh auto", padding: 24, color: "#18181b" }}>
        <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
        <p style={{ color: "#52525b", fontSize: 14 }}>Try again. If it keeps happening, tell your administrator{error.digest ? ` and quote ${error.digest}` : ""}.</p>
        <button type="button" onClick={reset} style={{ height: 40, padding: "0 20px", border: 0, borderRadius: 6, background: "#075985", color: "#fff", fontWeight: 500 }}>Try again</button>
      </body>
    </html>
  );
}
