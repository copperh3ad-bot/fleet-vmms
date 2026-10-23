"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { advanceSetupAction, type SetupProgress } from "./actions";

const STEPS: [string, string][] = [
  ["creating_database", "Creating your private database"],
  ["migrating_platform", "Setting up access and security"],
  ["migrating_tenant", "Building your fleet tables"],
  ["seeding", "Preparing your account"],
];

/** Keeps asking the server to do the next piece of work until the workspace is ready, then goes in. */
export function SetupProgressView() {
  const router = useRouter();
  const [progress, setProgress] = useState<SetupProgress>({ state: "creating_database" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let stop = false;
    (async () => {
      for (let i = 0; i < 60 && !stop; i++) {
        const r = await advanceSetupAction().catch((): SetupProgress => ({ state: "none", error: "The connection dropped. Try again." }));
        if (stop) return;
        setProgress(r);
        if (r.state === "ready" && r.slug) { router.replace(`/w/${r.slug}`); return; }
        if (r.state === "none" || r.state === "failed") return;
        if (r.error) await new Promise((ok) => setTimeout(ok, 2500));      // a step failed once: give it a moment, then the next round retries it
      }
    })();
    return () => { stop = true; };
  }, [attempt, router]);

  const at = STEPS.findIndex(([k]) => k === progress.state);
  const stuck = progress.state === "none" || progress.state === "failed";
  return (
    <div>
      <ol className="space-y-3">
        {STEPS.map(([k, label], i) => {
          const done = progress.state === "ready" || (at > i && !stuck);
          const current = !done && at === i && !stuck;
          return (
            <li key={k} className="flex items-center gap-3 text-sm">
              <span aria-hidden className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${done ? "bg-green-600 text-white" : current ? "animate-pulse bg-brand text-white" : "bg-zinc-200 text-zinc-500"}`}>{done ? "✓" : i + 1}</span>
              <span className={done || current ? "text-zinc-900" : "text-zinc-500"}>{label}</span>
            </li>
          );
        })}
      </ol>
      {progress.state === "ready" && <p role="status" className="mt-6 text-sm text-green-800">All set. Opening your workspace.</p>}
      {progress.error && !stuck && <p role="status" className="mt-6 text-sm text-amber-800">One step is taking longer than expected. Retrying.</p>}
      {stuck && (
        <div className="mt-6 space-y-3">
          <p role="alert" className="text-sm text-red-800">{progress.error ?? "Something went wrong while setting up your workspace."}</p>
          <button type="button" onClick={() => { setProgress({ state: "creating_database" }); setAttempt((n) => n + 1); }} className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm font-medium hover:bg-zinc-50">Try again</button>
        </div>
      )}
    </div>
  );
}
