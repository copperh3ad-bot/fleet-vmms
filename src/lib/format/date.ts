// How a date is shown everywhere in the app: dd/mm/yy (owner decision, ADR-060). Dates and times are read and shown in UTC, as the
// pages always did; a time carries the word UTC so nobody mistakes it for local time. Stored values stay ISO (yyyy-mm-dd) and the
// browser's own date picker is unchanged. Exports for machines keep ISO.
const p2 = (n: number) => String(n).padStart(2, "0");

function toDate(s: string | Date): Date {
  if (s instanceof Date) return s;
  return new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
}

/** 07/11/26. A missing value shows an em dash; text that is not a date is returned as it came. */
export function dmy(s: string | Date | null | undefined): string {
  if (!s) return "—";
  const d = toDate(s);
  if (Number.isNaN(d.getTime())) return typeof s === "string" ? s : "—";
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${p2(d.getUTCFullYear() % 100)}`;
}

/** 07/11/26 14:30 UTC */
export function dmyTime(s: string | Date | null | undefined): string {
  if (!s) return "—";
  const d = toDate(s);
  if (Number.isNaN(d.getTime())) return typeof s === "string" ? s : "—";
  return `${dmy(d)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())} UTC`;
}

/** Kept for the places that once showed day and month only: they now show the full dd/mm/yy too. */
export const dm = dmy;
