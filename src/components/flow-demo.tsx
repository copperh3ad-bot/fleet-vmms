"use client";
import { useEffect, useState } from "react";
import { Icon } from "@/components/icons";

// A small, clickable walk through one repair, so a visitor sees the approval trail instead of reading about it.
// The sample vehicle and figures are made up for the picture; nothing here is real data or a price.
const STEPS = [
  { key: "raise", title: "Raise", icon: "plus", who: "Driver or fleet officer", text: "A driver or fleet officer raises the job from a phone or a desk: vehicle, what is wrong, a photo.", state: "Submitted", tone: "bg-amber-100 text-amber-900", lines: ["Vehicle LEA-1234, brake pads worn", "Raised by a fleet officer", "Waiting for a manager"] },
  { key: "approve", title: "Approve", icon: "approve", who: "Fleet manager", text: "A different person approves it. Nobody approves their own job, and the approval is recorded with a name and a time.", state: "Approved", tone: "bg-green-100 text-green-900", lines: ["Approved by a fleet manager", "Not the person who raised it", "Recorded with date and time"] },
  { key: "workshop", title: "Workshop", icon: "workshop", who: "Workshop", text: "The workshop quotes by a link or on WhatsApp. No password, no sign-up. You compare the quotation with the invoice.", state: "At the workshop", tone: "bg-sky-100 text-sky-800", lines: ["Quotation received by link", "Invoice compared to the quotation", "Differences are flagged"] },
  { key: "paid", title: "Close", icon: "budget", who: "Accounts", text: "You pay what was approved. The cost lands on the vehicle, against its budget, ready for the next report.", state: "Closed", tone: "bg-zinc-200 text-zinc-800", lines: ["Cost added to the vehicle", "Checked against its budget", "Full history kept"] },
] as const;

export function FlowDemo() {
  const [i, setI] = useState(0);
  const [auto, setAuto] = useState(true);
  useEffect(() => {
    if (!auto || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((n) => (n + 1) % STEPS.length), 4500);
    return () => clearInterval(t);
  }, [auto]);
  const s = STEPS[i];
  const pick = (n: number) => { setAuto(false); setI(n); };
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_1.1fr] lg:items-center">
      <div role="tablist" aria-label="How one repair moves" className="space-y-2">
        {STEPS.map((x, n) => (
          <button key={x.key} role="tab" id={`flow-tab-${x.key}`} aria-selected={n === i} aria-controls="flow-panel" type="button" onClick={() => pick(n)}
            className={`btn-base flex w-full items-start gap-4 rounded-xl border p-4 text-left ${n === i ? "border-brand bg-white shadow-[var(--shadow-lift)]" : "border-zinc-200 bg-white/60 hover:border-zinc-300 hover:bg-white"}`}>
            <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${n === i ? "bg-brand text-white" : "bg-side text-badge"}`}><Icon name={x.icon} /></span>
            <span className="min-w-0">
              <span className="block text-xs font-medium uppercase tracking-wide text-zinc-500">Step {n + 1} · {x.who}</span>
              <span className="block font-semibold">{x.title}</span>
              {n === i && <span className="mt-1 block text-sm text-zinc-600">{x.text}</span>}
            </span>
          </button>
        ))}
      </div>
      <div id="flow-panel" role="tabpanel" aria-labelledby={`flow-tab-${s.key}`} className="rounded-2xl bg-side p-5 text-white shadow-[0_30px_60px_-30px_rgb(0_0_0/0.6)]">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-sm text-[#9FB2BE]">Job card JC-0142</p>
          <span key={s.key} className={`rise rounded-full px-3 py-1 text-xs font-semibold ${s.tone}`}>{s.state}</span>
        </div>
        <ol className="mt-5 flex items-center gap-2" aria-label="Progress">
          {STEPS.map((x, n) => (
            <li key={x.key} className="flex flex-1 items-center gap-2">
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors ${n <= i ? "bg-badge text-side" : "bg-white/10 text-[#9FB2BE]"}`}>{n + 1}</span>
              {n < STEPS.length - 1 && <span className="h-0.5 flex-1 rounded bg-white/10"><span className="block h-full rounded bg-badge transition-all duration-500" style={{ width: n < i ? "100%" : "0%" }} /></span>}
            </li>
          ))}
        </ol>
        <ul key={s.key} className="mt-5 space-y-2.5">
          {s.lines.map((l, n) => (
            <li key={l} className="rise flex items-center gap-3 rounded-lg bg-white/5 px-4 py-3 text-sm" style={{ "--i": n } as React.CSSProperties}>
              <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-badge" />{l}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-[#7E93A1]">An example for illustration. Your own vehicles and figures appear here once you sign up.</p>
      </div>
    </div>
  );
}
