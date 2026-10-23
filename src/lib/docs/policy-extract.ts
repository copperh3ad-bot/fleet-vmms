// Finds the numbers a vehicle policy states and maps each to a setting the system can apply. Plain patterns, no AI, so the
// same text always gives the same answer. Wording varies between companies and scans have mistakes, so nothing here is
// applied by itself: every finding carries the sentence it came from and a person confirms it (policy-reading.ts).
import { SETTINGS, checkSetting } from "@/lib/control/settings";

export type Target =
  | { kind: "setting"; key: string }
  | { kind: "service"; name: string; months?: number; km?: number }
  | { kind: "info" };

export type Finding = { id: string; label: string; value: string; target: Target; quote: string };

const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30 };
const num = (t: string): number | null => { const s = t.toLowerCase().replace(/,/g, ""); return /^\d+$/.test(s) ? Number(s) : (WORDS[s] ?? null); };

/** One line, plain quotes and dashes, table bars and stray marks removed. */
export function normalize(text: string): string {
  return text.replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[|]/g, " ").replace(/\s+/g, " ").trim();
}

function quoteAround(t: string, index: number, length: number): string {
  const from = Math.max(0, t.lastIndexOf(". ", index) + 2), to = t.indexOf(". ", index + length);
  const q = t.slice(from, to === -1 ? Math.min(t.length, index + length + 120) : to + 1).trim();
  return q.length > 260 ? `${q.slice(0, 257)}...` : q;
}

type Rule = { id: string; label: string; re: RegExp; make: (m: RegExpMatchArray) => { value: string; target: Target } | null };

const setting = (key: string, value: number): { value: string; target: Target } | null => {
  const def = SETTINGS.find((s) => s.key === key);
  if (!def || !checkSetting(def, String(value)).ok) return null;           // a value the setting would refuse is not offered
  return { value: String(value), target: { kind: "setting", key } };
};

const RULES: Rule[] = [
  { id: "policy_replace_years", label: "Replace a vehicle after (years)",
    re: /\b(?:(?:vehicles?|cars?)\b[^.]{0,40}?\b(?:replaced?|replacement)|(?:replaced?|replacement)\b[^.]{0,30}?\b(?:vehicles?|cars?))\b[^.]{0,40}?\b(?:on completion of|after|every|at)\s+(\w+)\s+years?\b/i,
    make: (m) => { const n = num(m[1]); return n ? setting("policy_replace_years", n) : null; } },
  { id: "policy_free_accidents", label: "Accidents the company absorbs per driver",
    re: /\b(?:waive|not penali[sz]e|not be penali[sz]ed|covered|absorb)[^.]{0,90}?\bfirst\s+(\w+)\s+accidents?\b/i,
    make: (m) => { const n = num(m[1]); return n ? setting("policy_free_accidents", n) : null; } },
  { id: "policy_accident_gap_months", label: "Months between covered accidents",
    re: /\b(?:minimum\s+|at least\s+)?(\w+)\s+(year|month)s?(?:'s?)?\s+(?:time\s+)?(?:must\s+)?lapse\b[^.]{0,40}?\baccidents?\b/i,
    make: (m) => { const n = num(m[1]); return n ? setting("policy_accident_gap_months", /year/i.test(m[2]) ? n * 12 : n) : null; } },
  { id: "policy_driver_share_pct", label: "Driver's share of repairs (%)",
    re: /\bshared\s+as\s+(\d{1,3})\s*%\s*by\s+the\s+(?:employer|company)\s*(?:&|and)\s*(\d{1,3})\s*%\s*by\s+the\s+employee/i,
    make: (m) => (Number(m[1]) + Number(m[2]) === 100 ? setting("policy_driver_share_pct", Number(m[2])) : null) },
  { id: "policy_driver_share_pct", label: "Driver's share of repairs (%)",
    re: /\bshared\s+as\s+(\d{1,3})\s*%\s*by\s+the\s+employee\s*(?:&|and)\s*(\d{1,3})\s*%\s*by\s+the\s+(?:employer|company)/i,
    make: (m) => (Number(m[1]) + Number(m[2]) === 100 ? setting("policy_driver_share_pct", Number(m[1])) : null) },
  { id: "service_oil_change", label: "Oil change interval",
    re: /\boil\b[^.]{0,40}?\b(?:every|after every)\s+(\d+)\s*months?\s*(?:or|and)\s*([\d,]+)\s*km\b/i,
    make: (m) => ({ value: `every ${m[1]} months or ${Number(m[2].replace(/,/g, "")).toLocaleString("en-US")} km`, target: { kind: "service", name: "Oil change", months: Number(m[1]), km: Number(m[2].replace(/,/g, "")) } }) },
  { id: "service_tyres", label: "Tyre replacement interval",
    re: /\b(?:tires?|tyres?)\b[^.]{0,40}?\b(?:due\s+)?after\s+([\d,]+)\s*km\b/i,
    make: (m) => ({ value: `every ${Number(m[1].replace(/,/g, "")).toLocaleString("en-US")} km`, target: { kind: "service", name: "Tyre replacement", km: Number(m[1].replace(/,/g, "")) } }) },
  // Found, but the system has nothing to apply them to yet. Shown so the manager sees what was understood and what was not.
  { id: "info_promotion_wait", label: "Wait before a car is changed after promotion",
    re: /\b(?:changed|replaced)\b[^.]{0,120}?\bat least\s+(\w+)\s+years?\b/i,
    make: (m) => { const n = num(m[1]); return n ? { value: `${n} years`, target: { kind: "info" } } : null; } },
  { id: "info_fitout_cap", label: "One-time cap on seat covers and floor mats",
    re: /\b(?:PKR|Rs\.?)\s*([\d,]+)\s*per\s+vehicle\b/i,
    make: (m) => ({ value: `${Number(m[1].replace(/,/g, "")).toLocaleString("en-US")} per vehicle`, target: { kind: "info" } }) },
  { id: "info_inspection", label: "Inspection schedule",
    re: /\b(\w+\s+monthly|quarterly|annually|yearly)\b[^.]{0,60}?\bin\s+([A-Z][a-z]+)\s+and\s+([A-Z][a-z]+)/i,
    make: (m) => ({ value: `${m[1].toLowerCase()}, in ${m[2]} and ${m[3]}`, target: { kind: "info" } }) },
];

export function extractPolicy(text: string): Finding[] {
  const t = normalize(text);
  const out: Finding[] = [];
  for (const r of RULES) {
    if (out.some((f) => f.id === r.id)) continue;            // the first rule that works for an id wins
    const m = t.match(r.re);
    if (!m || m.index === undefined) continue;
    const made = r.make(m);
    if (made) out.push({ id: r.id, label: r.label, value: made.value, target: made.target, quote: quoteAround(t, m.index, m[0].length) });
  }
  return out;
}
