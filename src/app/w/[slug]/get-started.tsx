import type { Onboarding } from "@/lib/dashboard/onboarding";
import { hideOnboardingAction } from "./onboarding-actions";

// The dashboard's "Get started" walk-through for a company that is still filling in its first data. The first unfinished step is
// the one to do next, so it is lit and carries the button; the rest wait their turn. Done steps stay visible, ticked, so a person
// can see how far along they are. It leaves by itself when every step is done, or when someone chooses to hide it.
export function GetStarted({ o, slug, to }: { o: Onboarding; slug: string; to: (h: string) => string }) {
  const total = o.steps.length;
  const next = o.steps.find((s) => !s.done);
  const pct = Math.round((o.doneCount / total) * 100);
  return (
    <section aria-labelledby="gs" className="panel rise rounded-xl border border-zinc-200/80 bg-white" style={{ "--i": 1 } as React.CSSProperties}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-zinc-100 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 id="gs" className="text-base font-semibold">Get started</h2>
          <p className="mt-0.5 text-sm text-zinc-500">Each step makes a part of this dashboard come alive with your own data. {o.doneCount} of {total} done.</p>
        </div>
        <div className="flex w-full items-center gap-3 sm:w-64" role="img" aria-label={`${o.doneCount} of ${total} steps done`}>
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100"><span className="meter block h-2 rounded-full" style={{ width: `${Math.max(pct, 4)}%` }} /></span>
          <span className="font-mono text-xs text-zinc-500">{pct}%</span>
        </div>
      </header>
      <ol className="divide-y divide-zinc-100">
        {o.steps.map((s, i) => {
          const current = s === next;
          return (
            <li key={s.key} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 ${current ? "bg-sky-100/50" : ""}`} aria-current={current ? "step" : undefined}>
              <span aria-hidden className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${s.done ? "bg-green-100 text-green-800" : current ? "bg-brand text-white" : "bg-zinc-100 text-zinc-500"}`}>{s.done ? "✓" : i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${s.done ? "text-zinc-500 line-through decoration-zinc-300" : ""}`}>{s.title}<span className="sr-only">{s.done ? " (done)" : ""}</span></p>
                {!s.done && <p className="mt-0.5 text-xs text-zinc-500">{s.why}{s.progress && <> <span className="font-medium text-amber-800">{s.progress}.</span></>}</p>}
              </div>
              {!s.done && <a href={to(s.href)} className={current ? "btn-base btn-primary inline-flex h-9 items-center rounded-lg px-4 text-sm font-medium text-white" : "btn-base inline-flex h-9 items-center rounded-lg border border-zinc-300 bg-white px-4 text-sm font-medium text-zinc-900 hover:bg-zinc-50"}>{s.cta}</a>}
            </li>
          );
        })}
      </ol>
      <footer className="flex justify-end px-5 py-2.5">
        <form action={hideOnboardingAction.bind(null, slug, true)}><button type="submit" className="text-xs text-zinc-500 underline hover:text-zinc-900">Hide this for now</button></form>
      </footer>
    </section>
  );
}

/** What stays on the dashboard after the walk-through is put away, so it can be brought back. */
export function GetStartedShow({ slug }: { slug: string }) {
  return (
    <form action={hideOnboardingAction.bind(null, slug, false)} className="text-right"><button type="submit" className="text-xs text-zinc-500 underline hover:text-zinc-900">Show the get-started steps</button></form>
  );
}
