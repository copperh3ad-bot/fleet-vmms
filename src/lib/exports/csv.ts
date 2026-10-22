// CSV output for spreadsheets. Two things matter beyond quoting:
//  1. Formula injection: a cell that starts with = + - @ (or a tab / carriage return) is run as a formula by Excel
//     and Sheets. Text from users (vendor names, descriptions) must not be able to do that, so such cells get a
//     leading apostrophe. Numbers and dates we produce ourselves are passed as numbers or ISO text and left alone.
//  2. A byte order mark, so Excel reads non-English names as UTF-8.

export type Cell = string | number | boolean | null | undefined | Date;
export type Column<T> = { header: string; value: (row: T) => Cell; /** true = never treated as text to neutralise, for numbers we format ourselves */ raw?: boolean };

const DANGEROUS = /^[=+\-@\t\r]/;

export function cell(v: Cell, raw = false): string {
  if (v === null || v === undefined) return "";
  let s = v instanceof Date ? v.toISOString() : typeof v === "boolean" ? (v ? "yes" : "no") : String(v);
  if (typeof v === "number" && Number.isFinite(v)) s = String(v);   // a negative number is a number, not a formula
  else if (!raw && DANGEROUS.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(columns: Column<T>[], rows: T[]): string {
  const lines = [columns.map((c) => cell(c.header, true)).join(",")];
  for (const r of rows) lines.push(columns.map((c) => cell(c.value(r), c.raw)).join(","));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

/** File names are built by us, never from user text, but keep them to safe characters anyway. */
export const csvFileName = (kind: string, today = new Date()) =>
  `${kind.replace(/[^a-z0-9-]/gi, "")}-${today.toISOString().slice(0, 10)}.csv`;
