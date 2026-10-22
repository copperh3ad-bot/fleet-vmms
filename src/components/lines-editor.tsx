"use client";
import { useState } from "react";
import { inputCls } from "@/components/form";

export type EditorLine = { kind: string; description: string; qty: string; unit_cost: string; ref?: string };
const KINDS: [string, string][] = [["part", "Part"], ["labour", "Labour"], ["service", "Service"], ["other", "Other"]];
const blank = (): EditorLine => ({ kind: "service", description: "", qty: "1", unit_cost: "" });

/**
 * Repeating cost lines. Posts parallel lists (line_kind, line_description, line_qty, line_unit_cost, line_ref) that
 * linesFromForm() in actions-util.ts reads back. `ref` ties a line to the quotation line it bills.
 */
export function LinesEditor({ initial, errors, title = "Lines" }: { initial?: EditorLine[]; errors?: Record<string, string>; title?: string }) {
  const [lines, setLines] = useState<EditorLine[]>(initial?.length ? initial : [blank()]);
  const set = (i: number, patch: Partial<EditorLine>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + (Number(l.qty) || 0) * (Number(l.unit_cost) || 0), 0);
  return (
    <div className="space-y-3">
      {errors?.lines && <p role="alert" className="text-xs text-red-700">{errors.lines}</p>}
      {lines.map((l, i) => {
        const err = (f: string) => errors?.[`lines.${i}.${f}`];
        return (
          <div key={i} className="grid grid-cols-2 gap-2 rounded-md border border-zinc-100 p-2 sm:grid-cols-[7rem_1fr_5rem_7rem_auto] sm:items-start sm:border-0 sm:p-0">
            <select name="line_kind" aria-label={`${title} kind`} className={inputCls} value={l.kind} onChange={(e) => set(i, { kind: e.target.value })}>
              {KINDS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
            </select>
            <div className="col-span-2 sm:col-span-1">
              <input name="line_description" aria-label="Description" placeholder="Description" className={inputCls} value={l.description} onChange={(e) => set(i, { description: e.target.value })} />
              {err("description") && <p role="alert" className="mt-1 text-xs text-red-700">{err("description")}</p>}
              {l.ref ? <span className="mt-1 block text-xs text-zinc-500">From the approved quotation</span> : null}
            </div>
            <div>
              <input name="line_qty" aria-label="Quantity" placeholder="Qty" inputMode="decimal" className={inputCls} value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} />
              {err("qty") && <p role="alert" className="mt-1 text-xs text-red-700">{err("qty")}</p>}
            </div>
            <div>
              <input name="line_unit_cost" aria-label="Unit cost" placeholder="Unit cost" inputMode="decimal" className={inputCls} value={l.unit_cost} onChange={(e) => set(i, { unit_cost: e.target.value })} />
              {err("unit_cost") && <p role="alert" className="mt-1 text-xs text-red-700">{err("unit_cost")}</p>}
            </div>
            <input type="hidden" name="line_ref" value={l.ref ?? ""} />
            <button type="button" onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : [blank()]))} className="h-10 rounded-md px-3 text-sm text-zinc-600 underline" aria-label={`Remove line ${i + 1}`}>Remove</button>
          </div>
        );
      })}
      <div className="flex items-center justify-between">
        <button type="button" onClick={() => setLines((ls) => [...ls, blank()])} className="h-10 rounded-md border border-zinc-300 bg-white px-4 text-sm">Add a line</button>
        <p className="text-sm text-zinc-600">Total <span className="font-medium tabular-nums text-zinc-900">{total.toLocaleString("en-US", { maximumFractionDigits: 2 })}</span></p>
      </div>
    </div>
  );
}
