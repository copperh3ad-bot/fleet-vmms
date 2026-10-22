/** Small RFC 4180 parser: quoted fields, "" escapes, CRLF or LF, a leading BOM, newlines inside quotes. */
export function parseCsv(input: string): string[][] {
  const s = input.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false, i = 0;
  while (i < s.length) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i += 2; continue; } quoted = false; i++; continue; }
      field += c; i++; continue;
    }
    if (c === '"' && field === "") { quoted = true; i++; continue; }
    if (c === ",") { row.push(field); field = ""; i++; continue; }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field); field = ""; rows.push(row); row = []; i++; continue;
    }
    field += c; i++;
  }
  if (quoted) throw new Error("The file ends inside a quoted value. Check for a missing closing quote.");
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

/** First row is the header. Returns objects keyed by lower-cased header, plus the 1-based file line of each row. */
export function csvToObjects(input: string): { headers: string[]; rows: { line: number; values: Record<string, string> }[] } {
  const all = parseCsv(input);
  if (all.length === 0) throw new Error("The file is empty.");
  const headers = all[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  const rows = all.slice(1).map((r, idx) => ({
    line: idx + 2,
    values: Object.fromEntries(headers.map((h, k) => [h, (r[k] ?? "").trim()])),
  }));
  return { headers, rows };
}
