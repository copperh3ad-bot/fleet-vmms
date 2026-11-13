# QA prompt: pre-deployment final check, 50 users, 5 organizations, performance sign-up to reports

Paste this whole file to the orchestrating agent. It is the last gate before a release. It reuses, and does not replace,
`QA-E2E-5USERS-PROMPT.md` (function list F1 to F17, invitation delivery notes), `QA-FULLFLOW-PROMPT.md` and
`QA-ALLROLES-REPORTS-PROMPT.md` (report checks, Block C). Read those three first, then follow this file. Where they disagree,
this file wins for this run.

You are the orchestrator. Repo: /Users/waqas/Documents/fleet-vmms (pull the latest master first; record the commit hash).
Read first: CLAUDE.md, docs/RBAC-MATRIX.md, docs/adr/ (all, especially 005, 007, 014, 030, 033, 045, 048, 059, 073, 075, 077,
078, 079, 082, 085 to 095), e2e/README.md, e2e/lib.mjs.
Your job is to FIND defects, gaps and slowness, not to fix or build anything. A failed step is FAIL. A missing capability is GAP.
A step not run is SKIPPED. Never report SKIPPED or unexecuted work as passed. The report must end in a release verdict
(section 8): GO, GO WITH CONDITIONS, or NO-GO.

## 0. Environment gate
1. Local throwaway stack only unless the owner writes in this run's brief: "run on production in a new QA workspace". Local
   means: database `fleet_vmms_e2e`, non-superuser DB account (ADR-073), mock-supabase, file outboxes (`ALLOW_FILE_MAILER=1`,
   `SMTP_URL=file:`, `WHATSAPP_FILE`, with their folders created first), `WHATSAPP_INVITE_TEMPLATE` unset, platform setting
   `otp_checks` off, a production build (`next build` then `next start`, never `next dev`, or the timings are meaningless).
   If the default port is taken, use another and confirm with `/api/health` that it is the Fleet OTG app.
2. Disk: need at least 3 GB free before starting. Remove old QA workspaces, containers and caches from earlier runs first and
   say what you removed.
3. Production is allowed only with that exact sentence, and then only five NEW workspaces named `qa-pre-<n>-<date>`, every
   record prefixed `QA-PRE-`. Never open `destinsolutions`, `beta` or any customer workspace. Email and WhatsApp stay SKIPPED
   unless the owner gave QA addresses and numbers.
4. If neither is possible, STOP and report what is missing. Do not waive this rule.
5. No deploys, no live migrations, no console changes, no secrets in files or logs, never commit, do not edit src/, db/ or tests/.
   Everything goes through the browser UI or the app's own server actions so `can()` and database guards run. No raw SQL that
   bypasses permissions. The one allowed seeding exception: if invitation delivery fails after the notes in the E2E prompt,
   create invitations with the repo's own `addEmployeeWithInvite`, then accept each one in the browser. Say so in the report.
6. Top of report: host, commit hash, database, ports, build mode, machine (CPU, RAM, disk), the five workspace slugs and plans.

## 1. Cast: 5 organizations, 50 users
Five separate organizations, each a different business, so tenant isolation and variety are tested:
| Org | Business | Plan | Vehicles | Flavour |
|---|---|---|---|---|
| 1 | Courier and delivery company | Pro | 12 | motorbikes, vans, pickups; many small repairs; odometer by WhatsApp menu |
| 2 | Construction and equipment contractor | Pro | 10 | loaders and forklifts on engine hours, trucks, cargo and trips |
| 3 | Corporate office with staff cars | Basic | 8 | cars and SUVs, HR vehicle requests, policy and accident cover |
| 4 | School or university transport | Basic | 10 | buses and coasters, paper expiries, gate security |
| 5 | Sales and distribution company | Pro | 10 | vans, trucks, third-party logistics providers, finance-heavy |
Plan setup (get this right first, it decides what is open): "Basic" means the real plan row `standard`, "Pro" means `pro`. Put each
workspace on that row. `scripts/set-plan.mts` only sets vehicle and user limits and creates feature-less plan rows, and a plan row
that says nothing about `fleet_ops` KEEPS trips and cargo (ADR-085), so a made-up "basic" plan will wrongly show Cargo. Before
any test, confirm in the QA database that `plans.features->>'fleet_ops'` is `false` for `standard` and `true` for `pro`
(control migration 0027), and that no Basic workspace is inside a Pro trial (a trial has Pro features). Proof for a Basic
workspace: its sidebar has no Trips and no Cargo, and `/w/<slug>/cargo` shows "Trip scheduling and cargo requests are part of the
Pro plan." Depots is not plan-gated and may show on Basic. Probe plan gates by reading that exact sentence, not by searching a page
for the words "Pro" or "upgrade" (those words appear on every page and give false positives).
Total: at least 50 vehicles. Vary make, year, odometer, category, custody (a named user, a department, unassigned), department
and paper expiry dates (some already expired, some inside 7 days, some inside 30 days, some far). Add them by a random mix of the
form and the Excel import. Randomise with a seed, print the seed in the report, and record every choice so a failure replays.

Exactly 50 users across the five organizations (10 per organization). Every one of the 8 roles must have AT LEAST 3 users in
the whole run (so at least 3 administrators, 3 fleet managers, 3 finance, 3 requesters, 3 logistics, 3 HR, 3 auditors, 3 gate
security), and every organization must have an administrator, a fleet manager and a requester. Suggested per organization (adjust
so the minimums hold): 1 administrator, 1 fleet manager, 1 finance, 3 requesters, 1 logistics (or HR in the Basic orgs), 1 HR,
1 auditor or gate security. Name pattern `QA-PRE <Org n> <Role> <k>`, employee codes `QP<n>-<ROLE>-<k>`. Vendors (workshops) and
third-party logistics providers hold no login: create at least 3 workshops per organization and 3 providers in each Pro
organization, driven only through their single-use `/q/` links.
Create each person the real way: sign-up or workspace creation, then Users page invitation, link, password, sign-in. Sign-up
(F17 flow, email confirmation, forgot password) is tested for at least two organizations from the public pages.

## 2. Agents, browsers, evidence
- Real browser (Playwright Chromium), one fresh context per user. Several organizations run in parallel; inside one organization
  two users must not edit the same record at once unless it is the concurrency test.
- Models: haiku for read-only gathering (lists, counts, screenshots, timings); sonnet to run a user's day and compare expected
  with actual; opus for policy judgement, severity ranking, performance analysis and the final report.
- Keep `state.json` (every org, user, vehicle, card, vendor, invoice id) and append one JSON line per step to
  `<scratchpad>/qa-pre/block-N.jsonl`: `{block, org, user, role, function, expected, actual, result, ms, evidence}`.
- Write the expected result from the ADRs and policy BEFORE acting. Screenshot every FAIL and every first page load. Capture
  console errors, failed requests and 5xx per step.

## 3. Performance measurement (every step, not a separate afterthought)
Record for every page load and every form submit: server response time, time to first content, time to interactive in the
browser, number of requests, and page weight. Use the browser performance timeline for client numbers and server logs for server
numbers. Budgets on the local production build (flag anything over; the machine is stated in the report so the owner can scale):
| Measure | Budget |
|---|---|
| Page load, any list or dashboard | under 2.0 s at p95, none over 5 s |
| Form submit (raise card, approve, pay, add vehicle) | under 1.5 s at p95, none over 4 s |
| CSV export up to 5,000 rows | under 5 s |
| Excel import of 50 vehicles | under 20 s, with a clear result |
| Public pages (landing, pricing, login) | under 1.0 s at p95 |
| Report pages with 6 months of data | under 3.0 s at p95 |
Then run these load steps and report the numbers, the first failure point and any error:
1. Ramp: 10, 25, then all 50 users signed in at once, each doing their role's normal clicks for 10 minutes. Report p50, p95, p99,
   error rate and memory of the app and database over time (a steady climb is a leak).
2. Spike: 20 requesters each submit a job card within the same 10 seconds in one organization. Check no lost or duplicate cards,
   numbering stays unique, and no connection-pool exhaustion.
3. Heavy data: bulk-create 2,000 job cards, 500 vehicles and 200 invoices in organization 5 (through the app's import or actions,
   prefix `QA-PRE-BULK`). Re-measure the dashboard, lists with filters and sort, search, reports and every export against the
   budgets. Look for missing pagination, slow queries (use `pg_stat_statements` or query logs), N+1 patterns.
4. Tenant fairness: while organization 5 is under load, measure organization 1's page times. One tenant must not slow the others
   beyond 1.5 times its quiet time.
5. Cold start and recovery: restart the app mid-run; sessions and data must survive; time to first good response.
6. Slow network: repeat the five most used pages and forms at a throttled 3G profile; nothing may time out, double submit, or
   lose typed data. Mobile 390 px layout on every form.

## 4. Real-life scenarios (run across the organizations, with the users assigned to vehicles)
Run each as a story with named users and check state, permissions, notifications and money at every step. Spread them so each
organization runs at least eight and every scenario runs somewhere.
1. Breakdown on the road: driver (requester) raises an urgent card with photos; fleet manager approves; three workshops quote by
   link; one is far above estimate (warning and explanation required); approve the cheapest sound quote; work order; workshop
   updates status; invoice arrives equal, then under, then over the approved amount; checker and payer are different people;
   payment lands on the right vehicle, department and budget.
2. Accident with and without policy cover; driver's share shown; challan entered; auditor sees it, cannot edit.
3. Repeat repair inside the window: same vehicle, same workshop, reason "previous repair not effective"; payer and written reason
   mandatory; seven-day warranty note on the invoice; routine service never flagged.
4. Papers: insurance, fitness, token tax, route permit expiring at 30, 14, 7, 0 days: exactly one message per threshold to the
   holder and fleet managers; renewing clears; an expired vehicle blocked from trips.
5. Odometer cycle: by link, by WhatsApp menu (Pro), by review screen; lower reading refused; huge jump flagged; reminder to
   non-responders only; service-due fires from kilometres, months and engine hours.
6. Employee leaves: user deactivated while signed in loses access at once; vehicle custody reassigned with history; their open
   cards stay readable; role changed while signed in takes effect.
7. New joiner with a vehicle request (HR): pool vehicle assigned by logistics; none free, so finance confirms budget, then
   approval, dealer quotes, add vehicle from the request, one-step hand-over; nobody decides their own.
8. Cargo and trips (Pro): weight-based vehicle suggestion; clash checks (double-booked, in workshop, papers expired); dispatch;
   gate security exit and entry with odometer; no free vehicle, so three providers quote beside rate cards; award; provider
   invoice by link; finance checks and pays; WhatsApp notice.
9. Month end: finance exports, reconciles payments to invoices and budgets; auditor reads the activity log (names and fields, never
   values); vehicle cost per km, spend by department, vendor scorecard, repeat-repair and accident reports equal the underlying
   records to the rupee.
10. Billing lifecycle: Basic trial length from the plans table, Pro trial 7 days once, due soon, late, locked (sign-in, Billing and
    every export still work), comped, plan switch by payment; a Basic organization refuses Pro pages by URL.
11. Bad actors: a requester pastes another card's id into the URL; a forged server-action POST with a stale id as each role (a
    success is Critical); an organization-2 user opens organization-1 ids by page, API and export (refused, no data in body);
    an admin who is also the approver is blocked by `admin_decides_others` in the button and in the database.
12. Messy data: Urdu and very long text, emoji, duplicate registration, wrong date formats (dd/mm/yy, ADR-060), negative and
    zero amounts, Excel import with a bad row, double-click submit (one record), back button after submit, session expiry
    mid-form, two people editing one card.
13. Karachi day boundary at 23:30 and 00:30 for reminders, send day, trial end, and "today" in reports.
14. Notifications and email: every notification count matches its list; daily digest reaches only intended people; failed email
    or WhatsApp delivery is visible to the administrator (the invitation warning added in commit 91a0f5a).

## 5. Function coverage
Run F1 to F17 from `QA-E2E-5USERS-PROMPT.md` at least once in each organization where the plan allows it (Pro functions only in
organizations 1, 2 and 5, and confirm they are closed in 3 and 4). Each function is performed by at least 3 different users where
the role allows it, then refused for forbidden roles. Sign-up to reports in order, per organization: sign-up and confirmation,
workspace first sign-in, users and roles, master data, vehicles and papers, service rules, budgets, job cards through payment,
vendors, requests, trips and cargo, odometer, reminders, notifications, dashboards, every export, activity log, billing, sign-out.
Then reconcile Block C of QA-ALLROLES-REPORTS-PROMPT.md on the data this run created, including the BULK data.

## 6. Cross-cutting checks
Console errors and 5xx on every page; labels and keyboard use on main forms; no price outside the pricing page; no secret or
connection string in any page source, response or log; security headers; robots, sitemap, llms.txt; every public link resolves;
back-up/restore sanity (dump one organization schema, restore it to a scratch database, row counts match); migrations apply
cleanly to a fresh database AND to one built from the previous release (`scripts/migrate-tenants.mts --check` clean); idempotent
second run of migrations changes nothing.

## 7. Output: `docs/qa/QA-PREDEPLOY-<date>.md` (leave uncommitted)
1. Environment proof, seed, commit, machine; the cast table with login worked for all 50.
2. Counts ok, FAIL, GAP, SKIPPED per block and per organization.
3. Function matrix: F1 to F17 by role by organization.
4. Scenario table: 14 scenarios by organization with result and evidence.
5. Performance section: the budget table with measured p50, p95, p99 per page and action, the load-step results, the slowest
   20 pages and queries with a suspected cause, resource curves, first failure point, and a plain statement of how many
   concurrent users this machine class supports.
6. Findings table: id, severity (Critical = permission bypass, wrong payable, tenant leak, lost audit trail, wrong report total,
   data loss; High; Medium; Low), function, org, user and role, exact steps, expected, actual, screenshot, suspected file or ADR.
7. GAP list and policy questions. Test data left behind and exact removal steps.
8. RELEASE VERDICT. NO-GO if any Critical, any High in money, permissions or tenant isolation, any data loss, any migration
   failure, or any budget missed by more than double at p95. GO WITH CONDITIONS lists each condition and its owner. GO only if
   none of those hold and no function was left SKIPPED without a stated, accepted reason. Then a 10-line executive summary.
Claim nothing passed that you did not execute in the browser.
