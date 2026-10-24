# Browser beta test

A scripted run of the whole product in a real browser, on your own machine. It signs companies up, adds people, uploads and reads a
policy, pays, issues tax invoices and certificates, locks a company, tries to reach one company from another, and checks phones,
accessibility and speed. `bash e2e/run.sh` runs all of it (about 6 minutes); name scenarios to run some:
`bash e2e/run.sh public companies workspace people billing lock quality` (later ones need the earlier ones).

What it uses, all local: a throwaway database (`fleet_vmms_e2e`, dropped and rebuilt each run), the built app on port 3100, and
`e2e/mock-supabase.mjs`, a small stand-in for Supabase login and file storage on port 54399. The stand-in is **not** Supabase: it does
not test Supabase's own rules (email delivery, storage row security, rate limits, leaked-password checks). Those need the real service.

Needs Postgres (psql on the socket in `E2E_PGHOST`, default `/tmp`), Node, and a Chrome or Chromium (`PLAYWRIGHT_CHROMIUM=/path`, or
`npx playwright-core install chromium`).

Output: every step with ok or FAIL, **findings** (things worth fixing even where a step passed), browser problems seen (console errors,
failed requests, 5xx), `e2e/report.json`, and screenshots of failures in `e2e/shots`.
