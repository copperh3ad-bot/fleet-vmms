import type { CSSProperties } from "react";

// The moving picture on the home page: a sample fleet dashboard, a job card moving through its steps, a driver sending an
// odometer reading and a reminder popping up. It is an illustration, not live data, and says so. All motion is in
// globals.css (it stops for visitors who ask for less motion); there is no script here, so it costs nothing to load.
const v = (vars: Record<string, string | number>) => vars as CSSProperties;

const BARS = [38, 52, 44, 68, 57, 81, 63, 92];
const STEPS = ["Requested", "Approved", "Workshop", "Invoiced", "Closed"];

export function HeroScene() {
  return (
    <div className="scene relative mx-auto w-full max-w-[540px] pb-44 pt-4 sm:pb-32" aria-hidden="true">
      <div className="orb orb-gold" />
      <div className="orb orb-teal" />

      <div className="scene-card relative rounded-2xl bg-white p-5 text-zinc-900">
        <div className="mb-4 flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full bg-red-300" /><span className="h-2.5 w-2.5 rounded-full bg-amber-200" /><span className="h-2.5 w-2.5 rounded-full bg-green-200" />
          <span className="ml-3 rounded-md bg-zinc-100 px-3 py-1 text-[11px] text-zinc-500">Fleet cost this month</span>
          <span className="ml-auto text-[10px] uppercase tracking-wide text-zinc-500">Sample view</span>
        </div>

        <div className="grid grid-cols-3 gap-3">
          {[["Vehicles", 48, "text-zinc-900"], ["Open jobs", 7, "text-brand"], ["Due soon", 5, "text-amber-800"]].map(([label, to, tone]) => (
            <div key={String(label)} className="rounded-lg border border-zinc-200 p-3">
              <p className="text-[11px] text-zinc-500">{label}</p>
              <p className={`mt-1 font-mono text-2xl font-semibold ${tone}`}><span className="count" style={v({ "--to": Number(to) })} /></p>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-lg border border-zinc-200 p-3">
          <div className="flex items-center justify-between text-[11px] text-zinc-500"><span>Cost per vehicle</span><span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">Repeat repair flagged</span></div>
          <div className="mt-3 flex h-28 items-end gap-2">
            {BARS.map((h, i) => (
              <span key={i} className={`${i === BARS.length - 1 ? "bar bar-flag bg-badge" : "bar bg-brand/80"} flex-1 rounded-t-md`} style={v({ "--h": h, "--i": i })} />
            ))}
          </div>
        </div>
      </div>

      <div className="float-a absolute bottom-0 left-0 w-full rounded-xl sm:w-[63%] border border-white/15 bg-[#1c2127]/95 p-4 text-white shadow-2xl backdrop-blur md:left-[-4%]">
        <div className="mb-3 flex items-center justify-between text-[11px] text-[#9FB2BE]"><span>Job card · Brakes squealing</span><span>No self-approval</span></div>
        <div className="relative flex flex-wrap items-center gap-1.5">
          {STEPS.map((s, i) => <span key={s} className="pipe-step rounded-full bg-white/10 px-2.5 py-1 text-[10px] font-medium text-[#C9D5DC]" style={v({ "--i": i })}>{s}</span>)}
        </div>
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-white/10"><div className="pipe-line h-full w-full rounded-full bg-badge" /></div>
      </div>

      <div className="float-b absolute bottom-0 right-0 hidden w-[34%] rounded-2xl border border-zinc-200 bg-white p-3 text-zinc-900 shadow-2xl sm:block">
        <p className="text-[10px] text-zinc-500">Monthly reading</p>
        <p className="mt-1 font-mono text-lg font-semibold"><span className="count" style={v({ "--to": 48210 })} /> <span className="text-[10px] font-normal text-zinc-500">km</span></p>
        <p className="shine mt-2 rounded-md bg-brand py-1.5 text-center text-[11px] font-semibold text-white">Send</p>
        <p className="mt-1.5 text-center text-[9px] text-zinc-500">No app. No password.</p>
      </div>

      <div className="toast absolute right-2 top-[-6px] flex items-center gap-2 rounded-full bg-badge px-3 py-1.5 text-[11px] font-semibold text-side shadow-lg md:right-0">
        <span>✓</span> Fitness papers renew in 12 days
      </div>
    </div>
  );
}
