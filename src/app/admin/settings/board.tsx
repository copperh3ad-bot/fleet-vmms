"use client";
// The operator's Settings screen: sections that fold, a search box, one compact row per setting with the explanation behind a "?", a Save that wakes only when the value
// changed (and Revert beside it), and a banner that follows the testing switches. Each row still saves through the same server action as before.
import { useEffect, useId, useMemo, useState, useActionState } from "react";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { inputCls } from "@/components/form";
import { useFormStatus } from "react-dom";
import type { AssistState } from "../actions";

export type Def = { key: string; label: string; hint: string; multiline: boolean; oneOf: string[] | null; numeric: boolean };
export type Group = { id: string; title: string; sub: string; defs: Def[] };
type Save = (key: string, p: FormState, f: FormData) => Promise<FormState>;

const matches = (d: Def, q: string) => !q || `${d.label} ${d.hint} ${d.key}`.toLowerCase().includes(q);

function SaveButton({ dirty }: { dirty: boolean }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={!dirty || pending} className="h-9 rounded-md bg-sky-800 px-4 text-sm font-medium text-white transition disabled:bg-zinc-200 disabled:text-zinc-500">{pending ? "Saving" : "Save"}</button>;
}

function Row({ def, saved, save, onSaved }: { def: Def; saved: string; save: Save; onSaved: (key: string, value: string) => void }) {
  const id = useId();
  const [value, setValue] = useState(saved);
  const [hint, setHint] = useState(false);
  const [state, run] = useActionState<FormState, FormData>(save.bind(null, def.key), {});
  useEffect(() => { if (state.ok) onSaved(def.key, value.replace(/\r\n/g, "\n").trim()); }, [state.ok]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setValue(saved); }, [saved]);                      // the assistant applied a change to this setting
  const clean = value.replace(/\r\n/g, "\n").trim();
  const dirty = clean !== saved;
  const failed = state.fields?.[def.key] ?? (state.error && dirty ? state.error : null);
  return (
    <form action={run} className="grid gap-2 border-t border-zinc-100 px-4 py-3 first:border-t-0 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)] sm:gap-4">
      <div>
        <div className="flex items-start gap-2">
          <label htmlFor={id} className="text-sm font-medium text-zinc-900">{def.label}</label>
          <button type="button" onClick={() => setHint((h) => !h)} aria-expanded={hint} aria-label={`About ${def.label}`} className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-xs text-zinc-500 hover:bg-zinc-100">?</button>
        </div>
        <p className="mt-0.5 text-xs text-zinc-500">{saved === "" ? "Not set" : "Set"}{dirty && <span className="ml-2 font-medium text-amber-700">· unsaved</span>}{!dirty && state.ok && <span className="ml-2 font-medium text-green-700">· saved</span>}</p>
        {hint && <p className="mt-2 rounded-md bg-zinc-50 p-2 text-xs leading-relaxed text-zinc-600">{def.hint}</p>}
      </div>
      <div className="space-y-2">
        {def.oneOf ? (
          <select id={id} name="value" value={value} onChange={(e) => setValue(e.target.value)} className={inputCls}>
            <option value="">Not set (default)</option>
            {def.oneOf.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : def.multiline ? (
          <textarea id={id} name="value" rows={value.split("\n").length > 3 ? 6 : 3} value={value} onChange={(e) => setValue(e.target.value)} className={`${inputCls} h-auto resize-y py-2 font-mono text-[13px]`} />
        ) : (
          <input id={id} name="value" value={value} inputMode={def.numeric ? "decimal" : undefined} onChange={(e) => setValue(e.target.value)} className={inputCls} />
        )}
        {failed && <p role="alert" className="text-xs text-red-700">{failed}</p>}
        <div className="flex items-center gap-3">
          <SaveButton dirty={dirty} />
          {dirty && <button type="button" onClick={() => setValue(saved)} className="text-sm text-zinc-600 underline">Revert</button>}
        </div>
      </div>
    </form>
  );
}

const EXAMPLES = ["Set the daily WhatsApp limit for everyone else to 25", "Turn the WhatsApp codes off for testing", "What does the rate side setting do?"];

/** Ask in plain words; the assistant answers and proposes changes; nothing is saved until the proposals are ticked and applied. */
function Assistant({ ask, apply, labels, onApplied }: { ask: (p: AssistState, f: FormData) => Promise<AssistState>; apply: (p: AssistState, f: FormData) => Promise<AssistState>; labels: Record<string, string>; onApplied: (changes: { key: string; value: string }[]) => void }) {
  const [asked, askRun, asking] = useActionState<AssistState, FormData>(ask, {});
  const [applied, applyRun, applying] = useActionState<AssistState, FormData>(apply, {});
  const [text, setText] = useState("");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const advice = asked.advice;
  useEffect(() => { setTicked(new Set((advice?.proposals ?? []).map((p) => p.key))); }, [advice]);
  useEffect(() => { if (applied.applied) onApplied(applied.applied); }, [applied.applied]);   // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = (advice?.proposals ?? []).filter((p) => ticked.has(p.key)).map((p) => ({ key: p.key, value: p.to }));
  const done = !!applied.applied && !applying;
  return (
    <section className="rounded-lg border border-sky-200 bg-sky-50/60 p-4" aria-labelledby="assist-h">
      <h2 id="assist-h" className="font-semibold text-zinc-900">Ask the assistant</h2>
      <p className="mt-0.5 text-xs text-zinc-600">Say what you want in plain words. It proposes changes and you choose which to apply; it never saves anything itself.</p>
      <form action={askRun} className="mt-3 space-y-2">
        <textarea name="request" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={1000} placeholder="For example: set the daily WhatsApp limit for everyone else to 25" aria-label="What do you want to change or know?" className={`${inputCls} h-auto py-2`} />
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={asking || text.trim().length < 3} className="h-9 rounded-md bg-sky-800 px-4 text-sm font-medium text-white disabled:bg-zinc-200 disabled:text-zinc-500">{asking ? "Thinking" : "Ask"}</button>
          {EXAMPLES.map((x) => <button key={x} type="button" onClick={() => setText(x)} className="rounded-full border border-sky-200 bg-white px-3 py-1 text-xs text-sky-900 hover:bg-sky-100">{x}</button>)}
        </div>
      </form>
      {asked.error && <p role="alert" className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{asked.error}</p>}
      {advice && (
        <div className="mt-4 space-y-3 text-sm" aria-live="polite">
          {advice.answer && <p className="text-zinc-800">{advice.answer}</p>}
          {advice.warnings.length > 0 && <ul className="list-disc space-y-1 rounded-md bg-amber-50 p-3 pl-7 text-amber-900">{advice.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {advice.proposals.length > 0 && !done && (
            <form action={applyRun} className="space-y-3">
              <ul className="divide-y divide-sky-100 rounded-md border border-sky-100 bg-white">
                {advice.proposals.map((p) => (
                  <li key={p.key} className="px-3 py-2">
                    <label className="flex cursor-pointer items-start gap-3">
                      <input type="checkbox" checked={ticked.has(p.key)} onChange={() => setTicked((t) => { const n = new Set(t); if (n.has(p.key)) n.delete(p.key); else n.add(p.key); return n; })} className="mt-1" />
                      <span><span className="block font-medium">{labels[p.key] ?? p.label}</span>
                        <span className="block text-zinc-700"><span className="text-zinc-500 line-through">{p.from === "" ? "not set" : p.from.length > 60 ? `${p.from.slice(0, 57)}...` : p.from}</span> → <strong>{p.to === "" ? "clear it" : p.to.length > 80 ? `${p.to.slice(0, 77)}...` : p.to}</strong></span>
                        {p.reason && <span className="block text-xs text-zinc-500">{p.reason}</span>}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <input type="hidden" name="changes" value={JSON.stringify(chosen)} />
              <div className="flex flex-wrap items-center gap-3">
                <button type="submit" disabled={applying || chosen.length === 0} className="h-9 rounded-md bg-sky-800 px-4 text-sm font-medium text-white disabled:bg-zinc-200 disabled:text-zinc-500">{applying ? "Saving" : `Apply ${chosen.length} change${chosen.length === 1 ? "" : "s"}`}</button>
                {applied.error && <span role="alert" className="text-sm text-red-700">{applied.error}</span>}
              </div>
            </form>
          )}
          {done && <p role="status" className="rounded-md border border-green-200 bg-green-50 p-3 text-green-800">{applied.ok}</p>}
        </div>
      )}
    </section>
  );
}

export function SettingsBoard({ groups, values, save, assist }: { groups: Group[]; values: Record<string, string>; save: Save; assist: { ask: (p: AssistState, f: FormData) => Promise<AssistState>; apply: (p: AssistState, f: FormData) => Promise<AssistState> } | null }) {
  const [query, setQuery] = useState("");
  const [saved, setSaved] = useState(values);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set(["testing"]));
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => groups.map((g) => ({ ...g, defs: g.defs.filter((d) => matches(d, q)) })).filter((g) => g.defs.length > 0), [groups, q]);
  const count = shown.reduce((n, g) => n + g.defs.length, 0);
  const codesOff = (saved.otp_checks ?? "").toLowerCase() === "off";
  const toggle = (id: string) => setOpenIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOpen = shown.every((g) => q || openIds.has(g.id));

  return (
    <div className="space-y-4">
      {assist && <Assistant ask={assist.ask} apply={assist.apply} labels={Object.fromEntries(groups.flatMap((g) => g.defs.map((d) => [d.key, d.label])))} onApplied={(cs) => setSaved((s) => ({ ...s, ...Object.fromEntries(cs.map((c) => [c.key, c.value])) }))} />}
      {codesOff && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span><strong>Testing mode is on.</strong> WhatsApp codes are not being asked for when someone joins or opens an invitation, and a number shared inside one company is allowed.</span>
          <button type="button" onClick={() => { setQuery("one-time"); }} className="font-medium underline">Show the switch</button>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search settings" aria-label="Search settings" className={`${inputCls} max-w-xs`} />
        <span className="text-sm text-zinc-500" aria-live="polite">{q ? `${count} found` : `${groups.reduce((n, g) => n + g.defs.length, 0)} settings`}</span>
        {!q && <button type="button" onClick={() => setOpenIds(allOpen ? new Set() : new Set(groups.map((g) => g.id)))} className="ml-auto text-sm text-zinc-700 underline">{allOpen ? "Fold all" : "Open all"}</button>}
      </div>
      {shown.length === 0 && <p className="rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-600">No setting matches &ldquo;{query}&rdquo;.</p>}
      {shown.map((g) => {
        const open = !!q || openIds.has(g.id);
        const set = g.defs.filter((d) => (saved[d.key] ?? "") !== "").length;
        return (
          <section key={g.id} className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <button type="button" onClick={() => toggle(g.id)} aria-expanded={open} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-zinc-50">
              <span><span className="block font-semibold text-zinc-900">{g.title}</span><span className="block text-xs text-zinc-500">{g.sub}</span></span>
              <span className="flex shrink-0 items-center gap-3 text-xs text-zinc-500"><span>{set} of {g.defs.length} set</span><span aria-hidden className={`transition-transform ${open ? "rotate-180" : ""}`}>⌄</span></span>
            </button>
            {open && <div className="border-t border-zinc-200">{g.defs.map((d) => <Row key={d.key} def={d} saved={saved[d.key] ?? ""} save={save} onSaved={(k, v) => setSaved((s) => ({ ...s, [k]: v }))} />)}</div>}
          </section>
        );
      })}
    </div>
  );
}
