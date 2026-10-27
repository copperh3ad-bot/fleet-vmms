// Turns the fields of an estimate or invoice form into the shape the schemas expect. One place, used by the workshop's one-time link page and by the
// signed-in staff who type in what a workshop emailed (ADR-033), so the two cannot drift apart.
const text = (f: FormData, k: string) => String(f.get(k) ?? "");

function lines(form: FormData, withLinks: boolean) {
  const count = Math.min(Number(text(form, "count")) || 0, 50);
  const out: Record<string, string>[] = [];
  for (let i = 0; i < count; i++) {
    const description = text(form, `description_${i}`).trim();
    const qty = text(form, `qty_${i}`).trim();
    const unit = text(form, `unit_cost_${i}`).trim();
    if (!description && !qty && !unit) continue;
    out.push({ kind: text(form, `kind_${i}`) || "service", description, qty, unit_cost: unit, ...(withLinks ? { quotation_line_id: text(form, `qlid_${i}`) } : {}) });
  }
  return out;
}

export const estimateFromForm = (form: FormData) => ({
  details: text(form, "details"), days_needed: text(form, "days_needed"), valid_until: text(form, "valid_until"), warranty_months: text(form, "warranty_months"), lines: lines(form, false),
});

export const invoiceFromForm = (form: FormData) => ({
  invoice_no: text(form, "invoice_no"), invoice_date: text(form, "invoice_date"), tax_amount: text(form, "tax_amount"), lines: lines(form, true),
});
