# QA prompt: Basic and Pro, every feature end to end, real database writes, with a verifiable input ledger

Paste this whole file to the orchestrating agent. It checks BOTH plans feature by feature, with real writes into the real
database through the real app (no mocks of application logic), and keeps an input ledger so that every number in the final
report can be checked afterwards by someone who was not there. It builds on `QA-E2E-5USERS-PROMPT.md` (functions F1 to F17,
invitation delivery notes), `QA-PREDEPLOY-50USERS-PROMPT.md` (cast, plan setup, performance) and `QA-ALLROLES-REPORTS-PROMPT.md`
(report reconciliation). Read them first. Where they disagree, this file wins for this run.

You are the orchestrator. Repo: /Users/waqas/Documents/fleet-vmms. Pull the latest master and record the commit hash.
Read first: CLAUDE.md, docs/RBAC-MATRIX.md, all of docs/adr/ (especially 021, 041, 062, 068, 078, 079, 085, 086, 087, 088, 091 to
095), e2e/README.md. You find defects, gaps and mismatches. You do not fix or build anything. A failed step is FAIL, a missing
capability is GAP, a step not run is SKIPPED. Never report SKIPPED or unverified work as passed.

## 0. What "live" means here, and the environment gate
"Live data" means the real running application writing to a real PostgreSQL database, with real sign-in, real server actions and
real database guards. It does not mean customer data.
1. Preferred: the local stack (database `fleet_vmms_e2e`, non-superuser app account per ADR-073, production build via `next build`
   and `next start`, mock login service, file outboxes for email and WhatsApp with their folders created first,
   `WHATSAPP_INVITE_TEMPLATE` unset, `otp_checks` as the E2E harness sets it). Confirm `/api/health` on the port you chose.
2. Production only if the owner wrote in this run's brief: "run on production in a new QA workspace". Then create only new
   workspaces named `qa-led-<plan>-<date>`, prefix every record `QA-LED-`, never open `destinsolutions`, `beta` or any customer
   workspace, send email and WhatsApp only to addresses and numbers the owner supplied (otherwise those steps are SKIPPED), and
   remove nothing you did not create.
3. Neither possible: STOP and report what is missing. Do not waive this.
4. No deploys, no migrations on any shared database, no console changes, no secrets in files, logs or the report, never commit,
   do not edit src/, db/ or tests/. Every write goes through the browser UI or the app's own server actions. You may open a
   SEPARATE READ-ONLY database connection (a role with `select` only, or a transaction set `read only`) for verification. Never
   write, update or delete with it, and never use it to "fix" data.
5. Plans: two workspaces on the REAL plan rows. `qa-led-basic` on `standard`, `qa-led-pro` on `pro`. Before testing, prove in the
   database that `plans.features->>'fleet_ops'` is false for `standard` and true for `pro`, that `org_billing.plan_key` and
   `tenant_subscriptions` agree for both, and that neither is inside a Pro trial. Use `scripts/create-workspace.mts --plan` and
   `scripts/set-plan.mts --tenant` on the local stack (they now keep both tables in step), or the Billing page on production.
6. Top of the report: host, commit hash, database name, ports, build mode, the two workspace slugs and plans, the seed.

## 1. The input ledger (the heart of this run)
Everything you enter is recorded before and after it is entered, so the final report can be verified line by line.
1. One append-only file per block, `<run-dir>/ledger/block-<n>.jsonl`, never edited, never reordered. One JSON object per step:
   `{seq, ts_utc, block, workspace, plan, user, role, function, action, inputs, expected, expected_effects, result, ms,
   screenshot, response_ids, prev_hash, hash}`.
   - `inputs` are the exact values typed or uploaded (file name plus SHA-256 for uploads), including amounts, dates, quantities,
     names and free text. Generated data comes from a printed seed, so the run can be replayed.
   - `expected` and `expected_effects` (the rows, statuses, amounts, notifications and audit lines this step should produce) are
     written BEFORE the step runs, from the ADRs and policy, never from what the screen shows afterwards.
   - `response_ids` are the ids the app returned or shows (card number, invoice number, trip number, request number).
   - `hash = sha256(prev_hash + canonical JSON of the row without hash)`. The first row's `prev_hash` is 64 zeros. Print the final
     hash of every file in the report; a changed line breaks every later hash.
2. A master `ledger/entities.json` maps every created thing to its ids: users, vehicles, vendors, providers, cards, quotes,
   invoices, payments, trips, cargo requests, vehicle requests, accidents, challans, budgets, rules, settings changed.
3. Money and counts ledger `ledger/money.csv`: for every approval, invoice, payment, budget and policy share, one row with
   workspace, entity id, amount, currency, who entered it, who approved it, running totals per vehicle, department and
   workspace. The report totals must be re-derived from this file.
4. Independent verification (after each block and at the end). With the read-only connection, run `ledger/verify.sql` (you
   write it; keep it in the run directory) that for each ledger row checks the database now contains exactly what
   `expected_effects` says: the row exists, the amount and status match, the actor matches, the audit trail has the event with
   the right person and time, no extra rows appeared, and counts per table equal ledger counts. Produce
   `verification-<block>.csv` with one line per ledger row: `seq, matched | MISSING | MISMATCH | EXTRA, detail`. A MISSING,
   MISMATCH or EXTRA is a finding, usually Critical if money, permissions, tenant data or the audit trail is involved.
5. Row-count and money reconciliation at the end: for each table the report cites, `select count(*)` and the sums, set beside
   the ledger's own totals. Differences must be zero or explained.
6. Tenant isolation proof from the ledger: every database row created in the run belongs to one of the two workspaces, and none
   of Basic's data appears in Pro's schema or the reverse (check by schema, and by `org_id` on control tables, per rule 9 of
   CLAUDE.md).
7. A skeptic pass: the opus agent picks 25 random ledger rows, finds each in the browser and in the database, and confirms
   the three agree (what was typed, what the page shows, what the table holds). Record the 25 seq numbers.

## 2. Agents, browsers, evidence
Real browser (Playwright Chromium), one fresh context per user. Models: haiku for read-only gathering and counts, sonnet to run
a user's flow and compare with the written expectation, opus for policy judgement, the skeptic pass and the report.
Screenshot every first page load, every FAIL and every money screen. Capture console errors and failed requests per step.
Two users never edit the same record at once unless it is the concurrency test.

## 3. Cast
Per workspace, at least one user in every role (administrator, fleet manager, finance, requester, logistics, HR, auditor,
gate security) and, in each, at least three requesters and two fleet managers, so approvals can be done by different people.
Add 4 vehicles per category the form offers in Pro and 8 in Basic (cars, SUV, pickup, van, truck, bus or coaster, motorbike,
equipment on engine hours), by a mix of the form and the Excel import. At least 3 workshops in both, and 3 logistics providers
in Pro. All people are created the real way (invitation link, password, emailed code where on, sign-in). Name pattern
`QA-LED <Plan> <Role> <k>`.

## 4. Basic plan: every feature, end to end
For each item: write expectations, run it with several different users and data sets, then run the forbidden roles and confirm
refusal, then verify against the database.
1. Public site and sign-up: landing, features, compare, pricing (only page with price figures), about, contact, terms, privacy,
   sign-up, confirmation, forgot password, robots, sitemap, llms.txt. **Contact form:** send one message and confirm (a) the row
   is in Admin, Messages and (b) the owner email arrived in the file outbox addressed to the settings address, with Reply-To set
   to the sender, and (c) a failing mail setup never loses the message or shows the visitor an error.
2. Billing for Basic: trial length equals `plans.trial_days` for `standard` (currently 10), due soon, late, locked (sign-in, Billing
   and every export still work), comped, one-month-free yearly rule, Pro trial offered once and lasting 7 days.
3. Users and roles: invite by email and by phone, join with company code plus the 6-digit code, role change, deactivate while
   signed in, phone number used in another workspace refused (ADR-082), every Settings switch saves and changes behaviour,
   `admin_decides_others` both ways (button hidden AND database refuses).
4. Master data: vehicles (all categories, duplicate refused, edit, retire with an open card handled safely, custody change and
   history, departments, depots and places), **vehicle load capacity in kg and load space in m3 (new)**, budgets per vehicle and
   department, service rules (months, km, hours, mixes), papers, employees, dd/mm/yy dates.
5. Odometer: by link and by review screen; lower reading refused; huge jump flagged; reminders; WhatsApp menu must be CLOSED.
6. Reminders: papers at 30, 14, 7, 0 days, one message per threshold to the holder and fleet managers; service due; daily digest.
7. Job cards: all ten work kinds, within and over `dept_approval_limit`, over vehicle budget, uncovered accident, photos, edit,
   cancel, approve, reject with and without reason, reopen with a reason of 5 or more characters (shorter refused), nobody approves
   their own, two approvers at once, full history with names and times.
8. Repeat work (ADR-094, 095): inside and just outside `flag_repeat_days`, same workshop, "previous repair not effective", payer
   and written reason mandatory, 7-day warranty note, routine service never flagged.
9. Policy on screen: replacement due, accident cover, driver's share; change a `policy_*` setting and see numbers change.
10. Quotations and work orders: 2 to 3 quotes through single-use links, one far above the estimate needs an explanation, approve,
    work order, workshop status by link, link reuse and expiry refused, emailed reply filed on the right card.
11. Invoices and payments: equal, under, over, never-approved line; checker is not the approver; payer is not the checker
    (ADR-086); `invoice.approve_payment` over limit (ADR-087); partial payments; double payment; pay unchecked or disputed
    invoice refused; dispute returns to the workshop; payment lands on the right vehicle, department and budget.
12. Vendors: add, edit, rate, scorecard, rate cards, KPI beside quotes.
13. HR vehicle requests: one open request per employee, pool vehicle, finance budget confirmation, approval, dealer quotes,
    add vehicle from the request with one-step hand-over, nobody decides their own.
14. Accidents and challans; compliance; why-it-keeps-breaking; notifications and counts.
15. Reports and exports: every dashboard and report, every one of the exports as CSV for permitted roles and 403 for others,
    activity log (administrator and auditor only) with who and which fields, never values, and a log line per download.
16. **Pro surfaces must be closed on Basic:** Trips, Cargo, logistics providers, WhatsApp menu, AI documents. Sidebar has no
    Trips and no Cargo; `/cargo` shows "Trip scheduling and cargo requests are part of the Pro plan." Check by URL, by direct
    action POST and by export. A forged cargo request POST as a Basic requester must be refused with no row written (verify).

## 5. Pro plan: everything in section 4, plus
1. Pro opens: trips, cargo, provider quotes and invoices, AI, WhatsApp menu.
2. Trips: schedule, approve, dispatch with vehicle and driver, clashes (double-booked, in workshop, papers expired), odometer out
   and back, gate security exit and entry, send to providers, quotes beside rate cards, award, provider invoice by link, finance
   check.
3. **Cargo with weight and volume (new):** requests by the app form, the published WhatsApp form (stubs or the file outbox) and
   the typed chat (which now also asks the optional volume after the weight). Weight and volume stored, shown on the card and in
   the cargo export. Vehicle suggestion: by weight, and by space: a vehicle whose recorded load space is smaller than the load is
   dropped; one with none recorded stays with the note "load space not recorded, check it fits". Vehicle load capacity and space
   set on a vehicle page. Logistics confirms, turns it into a trip, provider quote and invoice, delivered, WhatsApp notice.
4. AI: off until the administrator turns it on; document reading drafts only and a person saves; daily cap per number.
5. WhatsApp menu: job card, cargo, trip, odometer through the published forms (stubs or file outbox); daily cap. If neither stub
   nor file exists, SKIPPED.
6. Pro billing: trial 7 days once, switch Basic to Pro and back by the payment flow, bands, proration as the app states them.

## 6. Live data movement over time
Prove the data moves correctly across days, not just in one sitting. On the local stack you may move the app clock with the
harness's own clock control if it exists; otherwise create records with back-dated paper expiries and service dates and run the
daily job (cron route or script) after each simulated day. Cover: one day, 30 days of reminders, a month end close, a trial ending,
a late and a locked workspace, a repeat repair after 6 and 8 days. Record each clock step in the ledger. Karachi day boundary at
23:30 and 00:30.

## 7. Cross-cutting
Console errors and 5xx on every page; labels and keyboard use on main forms; 390 px layout; no price outside the pricing page; no
secret in any page, response or log; tenant isolation by URL, API and export; stale-id forged server-action POST as each role (a
success is Critical); double-click submit makes one record; back button after submit; session expiry mid-form; Urdu and long
text; two people editing one card. Performance: record each page and submit time in the ledger `ms`, flag page loads over 2 s
and submits over 1.5 s at p95 on the stated machine.

## 8. Output: `docs/qa/QA-BASIC-PRO-LEDGER-<date>.md` (leave uncommitted) and the run directory
1. Environment proof, seed, commit, machine, the two workspaces and their plan proof query results.
2. Counts of ok, FAIL, GAP and SKIPPED per plan and block. A feature matrix: every item in sections 4 and 5, by role, by plan.
3. Ledger section: file list with row counts and final hashes, `entities.json` summary, money totals re-derived from
   `money.csv`, verification results (counts of matched, MISSING, MISMATCH, EXTRA per block) and the skeptic pass table.
4. Findings table: id, severity (Critical = permission bypass, wrong payable, tenant leak, lost audit trail, wrong report total,
   plan gate open; High; Medium; Low), plan, function, user and role, ledger `seq`, exact steps, expected, actual, screenshot,
   suspected file or ADR.
5. Reconciliation: dashboards and reports against the ledger totals; every difference listed.
6. GAP list, policy questions, test data left behind and exact steps to remove it.
7. A 10-line executive summary and a release verdict (GO, GO WITH CONDITIONS, NO-GO) under these rules: NO-GO for any Critical,
   any MISSING or MISMATCH in money, permissions or tenant data, any plan gate open, data loss, or a migration failure.
Claim nothing passed that you did not execute in the browser and confirm in the database.
Give the owner the run directory path, so the ledger, entities, money file, verification files and screenshots can be re-checked
or replayed with the printed seed.
