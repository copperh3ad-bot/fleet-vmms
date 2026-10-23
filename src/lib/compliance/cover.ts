// The company's accident rule (policy settings): a driver's first accidents are covered by the company, provided enough
// months passed since the driver's previous accident. Everything after that, the driver bears the depreciation.
// Pure, so it is tested without a database. Accidents with no driver are never judged.
export type Cover = { cover: "covered" | "driver_pays"; nth: number };
type Item = { id: string; employee_id: string | null; occurred_at: string };

const addMonths = (iso: string, n: number) => { const d = new Date(iso); d.setUTCMonth(d.getUTCMonth() + n); return d.getTime(); };

/** `free` of 0 means the rule is off and nothing is judged. */
export function accidentCover(history: Item[], free: number, gapMonths: number): Map<string, Cover> {
  const out = new Map<string, Cover>();
  if (!(free > 0)) return out;
  const byDriver = new Map<string, Item[]>();
  for (const a of history) if (a.employee_id) byDriver.set(a.employee_id, [...(byDriver.get(a.employee_id) ?? []), a]);
  for (const list of byDriver.values()) {
    list.sort((x, y) => Date.parse(x.occurred_at) - Date.parse(y.occurred_at) || x.id.localeCompare(y.id));
    list.forEach((a, i) => {
      const prev = list[i - 1];
      const spaced = !prev || Date.parse(a.occurred_at) >= addMonths(prev.occurred_at, gapMonths);
      out.set(a.id, { cover: i + 1 <= free && spaced ? "covered" : "driver_pays", nth: i + 1 });
    });
  }
  return out;
}
