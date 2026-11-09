// Reading what a person typed on WhatsApp (ADR-079). Small and strict: a wrong answer is explained and asked again, never guessed.

export type Parsed<T> = { ok: true; value: T; label?: string } | { ok: false; error: string };
export const good = <T,>(value: T, label?: string): Parsed<T> => ({ ok: true, value, label });
export const bad = (error: string): Parsed<never> => ({ ok: false, error });

const WORDS = {
  greet: /^(hi|hii+|hello|hey|salam|salaam|assalam[ -]?o[ -]?alaikum|aoa|start|menu|help|0)[.! ]*$/i,
  cancel: /^(cancel|stop|quit|exit|abort)[.! ]*$/i,
  back: /^(back|previous|undo)[.! ]*$/i,
  skip: /^(skip|none|no|n\/a|-|nahi|nahin)[.! ]*$/i,
  yes: /^(yes|y|ok|okay|confirm|send|submit|haan|han|ji|ji haan)[.! ]*$/i,
  edit: /^(edit|change|correct)[.! ]*$/i,
};
export const isGreeting = (s: string) => WORDS.greet.test(s.trim());
export const isCancel = (s: string) => WORDS.cancel.test(s.trim());
export const isBack = (s: string) => WORDS.back.test(s.trim());
export const isSkip = (s: string) => WORDS.skip.test(s.trim());
export const isYes = (s: string) => WORDS.yes.test(s.trim());
export const isEdit = (s: string) => WORDS.edit.test(s.trim());

/** Free text with a minimum and maximum length, whitespace tidied. */
export function parseText(raw: string, min: number, max: number, what: string): Parsed<string> {
  const v = raw.replace(/\s+/g, " ").trim();
  if (v.length < min) return bad(`Please tell me ${what} (at least ${min} characters).`);
  if (v.length > max) return bad(`That is too long. Please keep ${what} under ${max} characters.`);
  return good(v);
}

/** A whole or decimal number, with thousands separators allowed. */
export function parseNumber(raw: string, opts: { min?: number; max?: number; integer?: boolean; what: string }): Parsed<number> {
  const v = raw.replace(/[, ]/g, "").replace(/km$/i, "");
  if (!/^\d+(\.\d+)?$/.test(v)) return bad(`Please send ${opts.what} as a number, for example 48320.`);
  const n = Number(v);
  if (opts.integer && !Number.isInteger(n)) return bad(`Please send ${opts.what} as a whole number.`);
  if (opts.min !== undefined && n < opts.min) return bad(`${opts.what[0].toUpperCase()}${opts.what.slice(1)} cannot be below ${opts.min}.`);
  if (opts.max !== undefined && n > opts.max) return bad(`${opts.what[0].toUpperCase()}${opts.what.slice(1)} cannot be above ${opts.max.toLocaleString("en-US")}.`);
  return good(n);
}

/** Pakistan time: the service is Pakistan only (ADR-039), so a date and time typed here is local time at +05:00. */
const OFFSET = "+05:00";
const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/**
 * A date and time: "12/11/2026 8:30", "12-11-2026 14:00", "2026-11-12 08:00", "12 Nov 8am", "today 3pm", "tomorrow 09:30". `now` is the clock, so tests do not depend on today.
 * Returns an ISO string with the Pakistan offset. The day-first order is used for slashes, as people write it here.
 */
export function parseDateTime(raw: string, now = new Date(), opts: { mustBeFuture?: boolean } = {}): Parsed<string> {
  let s = raw.trim().toLowerCase().replace(/\s+/g, " ").replace(/,/g, "");
  const local = new Date(now.getTime() + 5 * 3600_000);                         // "today" in Pakistan
  let y = local.getUTCFullYear(), mo = local.getUTCMonth() + 1, d = local.getUTCDate();
  let hh: number | null = null, mm = 0;

  const t = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|(\d{1,2}):(\d{2})\b/.exec(s);
  if (t) {
    if (t[3]) { hh = Number(t[1]) % 12 + (t[3] === "pm" ? 12 : 0); mm = Number(t[2] ?? 0); }
    else { hh = Number(t[4]); mm = Number(t[5]); }
    s = (s.slice(0, t.index) + " " + s.slice(t.index + t[0].length)).replace(/\s+/g, " ").trim();
  }
  if (hh === null || hh > 23 || mm > 59) return bad("Please include the time, for example 12/11/2026 8:30 or tomorrow 3pm.");

  let m: RegExpExecArray | null;
  if (/^today$/.test(s)) { /* as is */ }
  else if (/^tomorrow$/.test(s)) { const x = new Date(Date.UTC(y, mo - 1, d + 1)); y = x.getUTCFullYear(); mo = x.getUTCMonth() + 1; d = x.getUTCDate(); }
  else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s))) { y = Number(m[1]); mo = Number(m[2]); d = Number(m[3]); }
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s))) { d = Number(m[1]); mo = Number(m[2]); y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]); }
  else if ((m = /^(\d{1,2}) ([a-z]{3})[a-z]*(?: (\d{4}))?$/.exec(s)) && MONTHS[m[2]]) { d = Number(m[1]); mo = MONTHS[m[2]]; y = m[3] ? Number(m[3]) : y; }
  else return bad("I could not read that date. Please write it like 12/11/2026 8:30, or tomorrow 3pm.");

  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return bad("That date does not exist. Please check the day and month.");
  const iso = `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00${OFFSET}`;
  if (opts.mustBeFuture && Date.parse(iso) < now.getTime() - 60_000) return bad("That time has already passed. Please send a time in the future.");
  return good(iso);
}

/** How a stored time is read back to the person: "Thu 12 Nov 2026, 08:30". */
export function showDateTime(iso: string): string {
  const d = new Date(Date.parse(iso) + 5 * 3600_000);
  return `${d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export type Choice = { id: string; label: string };

/** Numbered options as text, "1. LHR-1001 (Toyota Hilux)". */
export const listChoices = (choices: Choice[]) => choices.map((c, i) => `${i + 1}. ${c.label}`).join("\n");

/** A number from the list, or the option's own words. */
export function pickChoice(raw: string, choices: Choice[], what: string): Parsed<Choice> {
  const v = raw.trim();
  if (/^\d{1,2}$/.test(v)) {
    const c = choices[Number(v) - 1];
    return c ? good(c, c.label) : bad(`Please reply with a number from 1 to ${choices.length}.`);
  }
  const hit = choices.filter((c) => c.label.toLowerCase().includes(v.toLowerCase()));
  if (v.length >= 2 && hit.length === 1) return good(hit[0], hit[0].label);
  return bad(`Please reply with a number from the list to choose ${what}.`);
}
