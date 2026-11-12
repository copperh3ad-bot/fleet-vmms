# QA prompt: every role, every use case, every report (Fleet OTG)

Paste this whole file to the orchestrating agent. It extends `docs/qa/QA-FULLFLOW-PROMPT.md` (one long end-to-end run) with a
systematic sweep: each role against each permission, each module's use cases including the unhappy paths, and every report
and export checked for structure and for numbers that reconcile with their source records.

You are the orchestrator of a QA run on Fleet OTG (Next.js + Postgres, multi-tenant, fleet maintenance and operations).
Repo: /Users/waqas/Documents/fleet-vmms. Before planning read: CLAUDE.md, docs/RBAC-MATRIX.md, docs/adr/ (002, 005, 007, 030, 033,
045, 048, 059, 070, 073, 075, 077, 078, 079, 082, 085, 086, 087, 088, 091, 092, 093, 094, 095), docs/qa/QA-FULLFLOW-PROMPT.md,
docs/qa/QA-FULLFLOW-2026-11-10.md, e2e/README.md and e2e/lib.mjs. Your job is to FIND defects and gaps, not to fix them. A step
that fails or cannot be done is a FAIL or a GAP, never a pass. A step you did not execute is SKIPPED, never a pass.

## 0. Safety rules (no exceptions)
1. Run only on the local throwaway e2e stack (database `fleet_vmms_e2e`, app on 3100, mock-supabase on 54399) or on one brand-new
   workspace `qa-allroles-<date>` on a NON-production database. Never fleetotg.com, `destinsolutions`, `beta`, or any customer
   workspace. If unsure which database a connection string points at, stop and report.
2. No deploys, no live migrations, no Netlify or Supabase production changes, no secrets in files, logs or the report.
3. Everything goes through the UI or the app's own server actions so `can()` and the database guards are exercised. No raw SQL
   that bypasses permissions. The only exception: seeding dated history (section 5) with a scratchpad script that imports the repo's
   own service modules and refuses to run unless the target is the QA workspace.
4. Email and WhatsApp stay on the machine: file outboxes (`ALLOW_FILE_MAILER=1`, `WHATSAPP_FILE`). Test as the non-superuser DB
   account (ADR-073). Platform setting `otp_checks` off in the QA env.
5. Two QA workspaces: A on Pro (trips, cargo, AI, providers) and B on Basic (to prove Pro features are closed and tenants are
   isolated). Use scripts/set-plan.mts.
6. Do not modify src/, db/ or tests/. Never commit. Artifacts go to `<scratchpad>/qa-allroles/`; the final report goes to
   `docs/qa/QA-ALLROLES-<date>.md`, uncommitted.

## 1. Agents and evidence
- haiku: read-only gathering (list pages, settings, permissions, export columns, row counts, screenshots, grep).
- sonnet: drive one role's browser session, compare expected with actual, write per-block findings.
- opus: policy-versus-behaviour judgement, severity ranking, final synthesis.
Run blocks in order; inside a block, roles may run in parallel but never open a second connection inside an open transaction.
Keep `state.json` (ids of users, vehicles, cards, vendors, invoices). Append evidence per step to
`<scratchpad>/qa-allroles/block-N.jsonl`: `{block, role, scenario, expected, actual, result: ok|FAIL|GAP|SKIPPED, evidence}`.
For every FAIL record the URL, exact clicks, the expected result and the real one, and a screenshot or response body.

## 2. Roles to create (real invitation flow, passwords set from the outbox link)
Administrator (`tenant_admin`), Fleet manager, Finance, Requester (x3: one limited to a single vehicle, one custodian of two,
one with no vehicle), Auditor, Logistics (department Logistics), HR, Gate security. Vendors and logistics providers hold no login:
drive them only through their single-use `/q/` links (4 workshops, 2 providers). Also: a **second** fleet manager, so one can
decide the other's requests. Sign each role in on a fresh browser context.

## 3. Block A: role by permission sweep (the access matrix)
For EVERY role, build the observed access table and diff it against docs/RBAC-MATRIX.md and the code (`src/lib/auth/can.ts`,
the `role_permissions` table):
1. Sidebar: list every entry shown. Anything shown that the role cannot use, or hidden but usable, is a finding.
2. Routes: open every `/w/<slug>/...` route (accidents, activity, billing, budgets, cargo, challans, compliance, depots,
   employees, export, invoices, job-cards, notifications, odometer, policy, quotations, reports, settings, trips, users,
   vehicle-requests, vehicles, vendors) and record allowed, forbidden (403 page) or redirected.
3. Writes: for each role attempt one write it MUST be refused (finance edits a job card; auditor creates anything; requester
   approves; HR touches job cards; gate security approves a trip; fleet manager records a payment on an invoice they checked...).
   Replay each refused write as a direct POST of the server action too (stale form, forged id). **A forbidden write that
   succeeds is Critical.**
4. Data scope: a limited requester sees only their vehicle's dashboard and job cards; Logistics sees only its department's
   vehicles; the auditor sees everything read-only; HR sees no job cards. Try another person's ids in the URL.
5. Segregation of duties, each tried from both sides: nobody approves their own job card, quotation or invoice check; the person
   who checked an invoice, or approved or raised its card, cannot record its payment (ADR-086); administrator decides others'
   work only when `admin_decides_others` is on, otherwise button hidden AND database refuses (ADR-088); sole-employee exception
   (ADR-077) appears only while the administrator is the only active employee and ends when a second is added.
6. Plan gating: on Basic, every Pro surface (trips, cargo, AI, WhatsApp menu, provider quotes) is closed by URL, not only hidden.
7. Billing states: trialing, active, due soon, late, locked, suspended, comped, Pro trial. A locked workspace still allows sign-in,
   Billing, and every export. Check the access banner text for each state and the trial lengths currently configured
   (Basic from the plans table, Pro trial 7 days, once per organization).

## 4. Block B: use cases by module (happy path, edge, abuse)
Write the expected result from the policy and ADRs BEFORE acting, then compare. For each scenario run it as the permitted role
and as one forbidden role.

**Vehicles and master data**: add by form and by Excel import (ADR-038); duplicate registration refused; every category incl.
hour-meter machines; custody and department change keeps history; retire a vehicle with open cards; dd/mm/yy dates (ADR-060);
document upload (registration book); depots and places (ADR-093).
**Papers and reminders**: expiry crossing 30/14/7/0 days sends exactly one reminder per threshold to the holder and fleet
managers (outbox); renewing clears it; accidents, challans, route permits, driving licences incl. learner licence setting.
**Servicing**: rules by months, km, hours and mixes; overdue, due soon, no history; odometer by link (single use, expired link,
reused link, lower reading than last, huge jump), by WhatsApp menu on Pro, reminder after three days only to non-responders;
send-day setting.
**Job cards**: raise for each of the ten kinds of work; within limit, over `dept_approval_limit`, over vehicle budget, accident
not covered by policy; approve, reject (with and without reason, reason shorter than 5 characters on reopen), requester reopens a
rejected card (ADR-095), cancel, edit after approval, concurrent approval by two approvers (only one wins), history shows every
event with person and time and names a workshop that acted by link.
**Repeat work (ADR-094, ADR-095)**: same vehicle, inside and just outside `flag_repeat_days` (default 30; the demo uses 60); same
reason, same service type line, reason "previous repair not effective"; routine service never a repeat. On approval the approver
must pick who pays (company, workshop under guarantee, driver) AND write a reason; approval without them is refused and nothing
changes; choosing a workshop that already worked on the vehicle in the window turns the card into a repeat. The answer shows on
the card and above the decision on the invoice page; the workshop-pays answer prompts the checker to consider a lower payable.
Warranty note appears when the same workshop finished work on the vehicle within 7 days before the card. State plainly that
payer and warranty are shown, not enforced on amounts.
**Policy on screen (G3)**: policy panel on card and invoice pages shows replacement due, accident cover, driver's share with the
amount; check the numbers against the company's `policy_*` settings and `accidentCover`; change a setting and re-check.
**Quotations and work orders**: 2 to 3 quotes per card, quote far above estimate, single-use link, expired link, reused link,
emailed reply filed on the card, approve one quote, work order issued, workshop status updates by link.
**Invoices and payments**: invoice equal to, below, above the approved amount and with a never-approved line; finance checks;
a different person pays; partial payments; double payment attempt; pay an unchecked or disputed invoice (must be refused); pay
over the limit or over the quote needs `invoice.approve_payment` (ADR-087); payment lands on the right vehicle, department,
budget and in exports. Dispute returns to the workshop. **A payable that should not be payable but is = Critical.**
**Vendors**: add, rate (ADR-036), scorecard values reconcile with their jobs; agreed rate cards.
**HR vehicle requests (ADR-059, 091)**: one open request per employee (second refused); Logistics assigns a pool vehicle; no pool
vehicle leads to purchase path: Finance confirms budget (`vreq.confirm_budget`) then fleet manager or administrator approves,
dealer quotations, adding the vehicle from `/vehicles/new?request=<id>` hands over in one transaction; nobody decides their own.
**Trips (Pro)**: request, approve, dispatch with vehicle and driver; clashes (double booking, vehicle in workshop, expired papers);
odometer out and back; gate security use; send to providers, compare quotes beside rate cards, award, provider invoice checked.
**Cargo (Pro, ADR-092)**: request with weight; vehicle suggestion by capacity, free in window, location where the last trip
ended; Logistics confirms; when none free, ask chosen providers; turn into trip; delivered state.
**Departments and budgets**: department spending limit, budget warnings, next-year planning, costs follow whoever held the vehicle.
**Users**: invite by email and by WhatsApp link, join with company code and 6-digit WhatsApp code, approve or refuse, one phone
belongs to one organization (ADR-082), deactivate a user mid-approval, role change takes effect without re-login.
**Settings (H)**: every company switch on the Settings screen saves, persists after reload, and changes behaviour (learner
licence, odometer WhatsApp, send day, `admin_decides_others`, policy rules, flags). Unset values show their defaults.
**Company activity log (ADR-070, migration 0061)**: administrator and auditor only; filters by record and period; newest 200;
shows who and which fields changed, never old or new values; each download is logged.
**Notifications**: right people, once, nobody extra; unread counts.
**AI and WhatsApp (Pro)**: AI off until switched on; document reading drafts only, a person saves; WhatsApp job card draft needs
confirmation; daily message cap per number. Stub the model; if no stub, SKIPPED.
**Public site and sign-up**: landing, features, compare, pricing (the only page with price figures), about, contact form, terms,
privacy, sign-up (trial length matches the plans table), email confirmation, forgot-password, robots, sitemap, llms.txt; no price
anywhere else; 390px pass; no console errors; links all resolve; marketing claims match what the product does.

## 5. Block C: reports and exports (structure AND numbers)
Seed 12 months of history first (section 3 safety exception) with enough variety that every report has data in some periods and
none in others. Then, for EACH report page and EACH export kind below, as each role allowed to see it:
`Reports page`: spending by month, needs a look (flags), by department, by reason, costliest vehicles, by workshop, by driver,
cost per kilometre, cost per engine hour, time in the workshop and fleet availability, "Why it keeps breaking" (`/reports/breaking`),
repeat repairs, budgets against spend, dashboards per role.
`Export kinds`: vehicles, job-cards, invoices, documents, accidents, challans, budgets, costs-by-vehicle, repeat-repairs, cost-per-km,
cost-per-hour, workshop-time, outsourced-trips, cargo, vehicle-requests, flags.
Checks per report:
1. **Structure**: title, period subtitle, column headers in the same order and wording on screen and in CSV, units and currency
   (PKR) shown, dates dd/mm/yy, no raw ids or `null`/`undefined` text, sensible sort (worst first where stated), long names do not
   break the layout, 390px layout readable, empty state sentence instead of a blank panel or a crash.
2. **Reconciliation**: the sum of "by month" equals the sum of "by vehicle", "by reason", "by workshop", "by department" and "by
   driver" for the same period (explain any legitimate difference, e.g. jobs with no department); the same total as the closed and
   paid job cards and checked invoices listed in the job-cards and invoices exports; cost per km = cost / km driven from odometer
   readings (recompute three vehicles by hand); engine-hour report likewise; availability % = 1 minus workshop days over period
   days (recompute one vehicle); budget remaining = budget minus counted spend; repeat-repair list equals the cards flagged repeat.
   A cancelled, rejected, draft or unpaid-disputed item must not be counted as spend.
3. **Filters**: period (3/6/12 months), department including "No department"; a filter changes every panel consistently; filter
   plus export gives the same rows as the screen.
4. **Scope by role**: Finance, Auditor, Fleet manager, Administrator see the whole company; Logistics only its department; Requester
   only its own vehicle; roles without `report.view` get 403 on the page AND on the export URL. A locked workspace can still export.
5. **Export file**: opens in Excel (UTF-8 BOM, commas and quotes in names escaped, no formula injection: a vehicle name starting
   with `=`, `+`, `-` or `@` must be neutralised), row count equals the screen's, filename names the kind and date, large export
   (1,000+ rows) completes, export is logged in the activity log.
6. **Changes propagate**: pay an invoice, close a card, add an odometer reading, change a budget; the affected report panels change
   at once and by the right amount.
7. Flag rules: "Needs a look" lists each flag kind once per vehicle with a working link to the record and disappears when resolved.

## 6. Block D: cross-cutting
Tenant isolation (workspace B user opens workspace A ids by URL, API route and export: all refused, no data in the body); browser
console errors and failed requests on every page visited; keyboard use and form labels on the main forms; timezone and day
boundaries (record at 23:30 and 00:30 Karachi time lands on the right day); double-click submit creates one record; back button
after submit; session expiry mid-form keeps the draft or fails clearly; very long text and Urdu text in names and reasons;
concurrency (two people editing one card); rate limits on public links and sign-up.

## 7. Output: `docs/qa/QA-ALLROLES-<date>.md`
1. Run summary: environment (prove it was not production), roles created, counts ok/FAIL/GAP/SKIPPED per block.
2. Access matrix: observed role by page and by write, with every difference from docs/RBAC-MATRIX.md highlighted.
3. Findings table: id, severity (Critical = permission bypass, wrong payable, tenant leak, lost audit trail, wrong report total;
   High; Medium; Low), block, role, steps to reproduce, expected, actual, evidence, suspected file or ADR.
4. Report audit sheet: for each report and export: structure ok?, reconciles?, scope by role ok?, export ok?, notes.
5. GAP list (described by the owner or implied by an ADR but not present), each with what exists and a suggested scope.
6. Policy questions where the policy was silent or contradictory.
7. Test data left behind (prefix `QA-AR-`) and how to remove the QA workspaces.
End with a 10-line executive summary. Claim nothing passed that you did not execute.
