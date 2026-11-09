"use client";
// The operator's Settings screen: sections that fold, a search box, one compact row per setting with the explanation behind a "?", a Save that wakes only when the value
// changed (and Revert beside it), and a banner that follows the testing switches. Each row still saves through the same server action as before.
import { useEffect, useId, useMemo, useState, useActionState } from "react";
import type { FormState } from "@/app/w/[slug]/actions-util";
import { inputCls } from "@/components/form";
import { useFormStatus } from "react-dom";

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

export function SettingsBoard({ groups, values, save }: { groups: Group[]; values: Record<string, string>; save: Save }) {
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
