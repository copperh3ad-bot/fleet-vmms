// How an AI draft fills the invoice form (ADR-034). The form starts from the lines of the approved estimate, so a draft line goes onto the approved line it
// was matched to (its figures replace the estimate's, since the workshop may have billed a different quantity or price); a draft line that matched
// nothing goes below as an extra line, which the person who checks the invoice will see as "not in the estimate". Pure, so it is tested without a browser.
import type { Draft } from "./document";

export type ApprovedRow = { id: string; kind: string; description: string; qty: string; unit_cost: string };
export type FormRow = { qlid: string | null; kind: string; description: string; qty: string; unit_cost: string };

const n = (v: number) => String(Number(v.toFixed(4)));

export function invoiceRows(approved: ApprovedRow[], draft: Draft | null): { linked: FormRow[]; extra: FormRow[] } {
  if (!draft) return { linked: approved.map((a) => ({ qlid: a.id, kind: a.kind, description: a.description, qty: String(Number(a.qty)), unit_cost: String(Number(a.unit_cost)) })), extra: [] };
  const used = new Set<number>();
  const linked = approved.map((a): FormRow => {
    const i = draft.lines.findIndex((l, idx) => !used.has(idx) && l.matches_line_id === a.id);
    if (i < 0) return { qlid: a.id, kind: a.kind, description: a.description, qty: String(Number(a.qty)), unit_cost: String(Number(a.unit_cost)) };
    used.add(i);
    const l = draft.lines[i];
    return { qlid: a.id, kind: l.kind, description: l.description, qty: n(l.qty), unit_cost: n(l.unit_cost) };
  });
  const extra = draft.lines.flatMap((l, i): FormRow[] => (used.has(i) ? [] : [{ qlid: null, kind: l.kind, description: l.description, qty: n(l.qty), unit_cost: n(l.unit_cost) }]));
  return { linked, extra };
}
