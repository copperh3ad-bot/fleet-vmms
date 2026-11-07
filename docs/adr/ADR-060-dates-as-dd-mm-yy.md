# ADR-060: Dates are shown as dd/mm/yy

Status: accepted, 2026-11-07 (built, not deployed). Owner decision: "date format dd/mm/yy everywhere"; the browser date pickers stay as they are.

## Decision
- One module, `src/lib/format/date.ts`, shows every date: `dmy` (07/11/26), `dmyTime` (07/11/26 14:30 UTC) and `dm` (the same as `dmy`; the old "7 Nov" short form is gone). `dayMonth` in `src/lib/labels.ts` also returns dd/mm/yy. Emails (payment alerts and confirmations, the bill) and the compliance, employees and job card pages use the same helper; the bill number keeps its compact date because it is an identifier. Pages no longer define their own date formatters.
- Dates and times are still read and shown in UTC, as before. A time carries the word UTC.
- A missing date shows "—". Text that is not a date is shown as it came.
- The welcome band keeps the weekday in words ("Saturday 07/11/26").
- **Unchanged on purpose:** stored values (ISO yyyy-mm-dd), the browser's own date picker boxes (they follow each browser's language), month-only labels such as "November 2026" for a monthly odometer period, CSV and Excel exports (ISO, for machines).

## Tests
`tests/date-format.test.ts`.
