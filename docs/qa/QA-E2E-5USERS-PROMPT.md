# QA prompt: five users in every role, then every function end to end in the browser

Paste this whole file to the orchestrating agent. It is the "do everything with real people" run. The companion prompts are
`QA-FULLFLOW-PROMPT.md` (one long repair-to-payment story) and `QA-ALLROLES-REPORTS-PROMPT.md` (access matrix and report
reconciliation). Reuse their report checks (Block C) at the end of this run instead of rewriting them.

You are the orchestrator of a QA run on Fleet OTG (Next.js, multi-tenant Postgres, fleet maintenance and operations).
Repo: /Users/waqas/Documents/fleet-vmms. Read first: CLAUDE.md, docs/RBAC-MATRIX.md, docs/adr/ (especially 002, 005, 007, 030,
033, 045, 048, 059, 070, 073, 075, 077, 078, 079, 082, 085, 086, 087, 088, 091, 092, 093, 094, 095), e2e/README.md,
e2e/lib.mjs. Your job is to FIND defects and gaps, not to fix or build anything. A step that fails is FAIL. A capability that is
missing is GAP. A step you did not run is SKIPPED. Never mark SKIPPED or unexecuted work as passed.

## 0. Environment gate (decide this before touching a browser)
Writes will create hundreds of records, so the environment matters more than anything else in this run.
1. Preferred: the local throwaway stack (`bash e2e/run.sh` pattern: database `fleet_vmms_e2e`, app on port 3100, mock-supabase on
   54399, non-superuser DB account per ADR-073, file outboxes `ALLOW_FILE_MAILER=1` and `WHATSAPP_FILE`, platform setting
   `otp_checks` off). If Docker or Postgres is missing, try to start them; if that fails, say exactly what is missing.
2. Only if the owner wrote, in this run's brief, "run on production in a new QA workspace": create ONE brand-new workspace named
   `qa-e2e-<date>` through the public /signup page, use only it, and keep every record prefixed `QA-E2E-`. Never open, read or
   write `destinsolutions`, `beta` or any other customer workspace. Real email and WhatsApp may then be sent, so use only
   addresses and numbers the owner supplied for QA; if none were supplied, mark every email and WhatsApp step SKIPPED.
3. If neither (1) nor (2) is possible, STOP and report. Do not fall back to a customer workspace. Do not "waive" this rule yourself.
4. No deploys, no live migrations, no Netlify or Supabase console changes, no secrets in files, logs or the report. Never commit.
   Do not edit src/, db/ or tests/. Everything goes through the browser UI or the app's own server actions so `can()` and the
   database guards run. No raw SQL that bypasses permissions.
5. Record the environment proof at the top of the report (host, database name, workspace slug, plan).
6. Plans: workspace A on Pro (trips, cargo, AI, logistics providers, WhatsApp menu). Workspace B on Basic (to prove Pro surfaces
   are closed and tenants are isolated). Use scripts/set-plan.mts locally; on production use the Billing page's own steps only.

## 1. Agents, browsers and evidence
- Drive a real browser (Playwright with Chromium, or claude-in-chrome). One fresh browser context per user, so sessions never leak.
- haiku: read-only gathering (lists, settings, counts, grep, screenshots). sonnet: run a user's flows, compare expected with actual.
  opus: policy judgement, severity ranking, the final report.
- Users of different roles may work in parallel contexts; two users must not edit the same record at the same moment unless that
  is the concurrency test. Keep `state.json` (every user, vehicle, card, vendor, invoice id) and append one JSON line per step to
  `<scratchpad>/qa-e2e/block-N.jsonl`: `{block, user, role, function, expected, actual, result: ok|FAIL|GAP|SKIPPED, evidence}`.
- Screenshot every FAIL and every page's first load. Capture console errors and failed network requests per step.
- Write the expected result from the ADRs and policy BEFORE acting. Do not copy the expectation from what the screen shows.

## 2. Block 1: create the people (the real invitation flow)
Sign up the company (administrator) through /signup. Then create five users in EACH role through the Users page and the real
invitation links (set each password from the single-use link in the outbox). Use the name pattern `QA-E2E <Role> <n>` and
employee codes `QE-<ROLE>-<n>`.
| Role | Count | Notes |
|---|---|---|
| Administrator (tenant_admin) | 5 (the signed-up owner is #1) | at least two must be added while another approver is active, to prove the strict rule |
| Fleet manager | 5 | |
| Finance | 5 | |
| Requester | 5 | #1 limited to one vehicle; #2 custodian of two; #3 no vehicle; #4 and #5 in different departments |
| Logistics | 5 | departments Logistics (3) and Operations (2) |
| HR | 5 | |
| Auditor | 5 | read-only |
| Gate security | 5 | |
Vendors hold no login. Create 5 workshop vendors and 5 third-party logistics providers, and drive them ONLY through their
single-use `/q/` links, plus one emailed-reply route (ADR-033).
For each of the 40 logins: sign in, confirm the right workspace and role label, confirm the sidebar equals what
docs/RBAC-MATRIX.md allows, sign out, sign in again. Also test: wrong password, invite link used twice, expired invite, a user
deactivated while signed in, role changed while signed in, a phone number already in another workspace (ADR-082), and joining with a
company code plus the 6-digit code.

Invitation delivery in the local stack: `WHATSAPP_INVITE_TEMPLATE` must be UNSET (a copied `.env.local` may carry it). The app then
shows "Send on WhatsApp / text message" buttons whose text holds the one-time link; take the link from the button's href. Give every
invitee an email address too, so the link also lands in the `SMTP_URL=file:` outbox. Create the outbox and `WHATSAPP_FILE` folders
before starting the app (the file writers do not create folders). Use port 3101 if 3100 is taken. Only if all of that fails, seed
invitations with the repo's `addEmployeeWithInvite` and accept each in the browser, and say so in the report.

## 3. Block 2: master data (administrator and fleet managers, five different people)
Each of the 5 fleet managers adds 4 vehicles: 20 in total across every category the form offers (car, SUV, pickup, van, truck,
bus or coaster, motorbike, loader or forklift on engine hours), varied make, year, odometer, custody, department and paper expiry.
Use the Excel import for 10 and the form for 10. Then exercise: duplicate registration refused; edit; custody change and its
history; retire a vehicle that has an open card (must be handled safely); departments and spending limits; depots and places;
budgets per vehicle and per department; service rules by months, kilometres, hours and mixes; papers (insurance, fitness, token tax,
route permit, registration book scan); driving licence and learner licence setting; employees list; dd/mm/yy dates (ADR-060).

## 4. Block 3: every function, each done by FIVE different users where the role allows it
For each function below, five different permitted users each perform it once with different data (so 5 job cards raised by 5
different requesters, 5 approved by 5 different approvers, and so on). Then the forbidden roles try the same and must be refused.
Record both the happy result and the refusal. Test the edge cases in brackets.

**F1 Odometer** (by link, by WhatsApp menu on Pro, by review screen): reading accepted; lower than last; huge jump; link reused;
link expired; monthly reminder after the send day; reminder to non-responders only after three days.
**F2 Reminders**: papers crossing 30, 14, 7 and 0 days send exactly one message per threshold to the vehicle holder and fleet
managers; renewing clears; service due; daily digest email; nobody extra gets it.
**F3 Job cards**: raise all ten kinds of work; within and over `dept_approval_limit`; over vehicle budget; accident the policy does
not cover; photos attached; edit before approval; cancel; approve; reject with and without a reason; requester reopens a rejected card
with a reason of 5 or more characters (a shorter one is refused); nobody approves their own card; two approvers click at once (one
wins); history lists every step with a name and a time.
**F4 Repeat work (ADR-094, 095)**: same vehicle inside and just outside `flag_repeat_days`; same reason; same service type line;
reason "previous repair not effective"; routine service is never a repeat. Approving a repeat needs who pays (company, workshop under
guarantee, driver) and a written reason, and is refused without both. Picking a workshop that already worked on the vehicle in the
window makes it a repeat. The answer shows on the card and above the invoice decision. The 7-day warranty note appears on the
invoice page. Confirm payer and warranty are shown, not enforced on amounts.
**F5 Policy on screen**: replacement due, accident cover, driver's share with the amount on card and invoice pages; change a
`policy_*` setting and see the numbers change.
**F6 Quotations and work orders**: 2 to 3 quotes per card through links; one far above the estimate (warning and mandatory
explanation); approve a quote; work order issued; workshop updates status by link; link single use, expired, wrong-link reuse;
emailed reply filed on the right card.
**F7 Invoices and payments**: invoice equal to, under, over the approved amount and with a never-approved line; checker is a
different person than the approver; payer is a different person than the checker (ADR-086); over the limit or over the quote needs
`invoice.approve_payment` (ADR-087); partial payments; double payment attempt; pay an unchecked or disputed invoice (must be
refused); dispute returns to the workshop; payment lands on the right vehicle, department and budget.
**F8 Vendors**: add, edit, rate, scorecard (days, quote against bill, rework), agreed rate cards, vendor KPI beside quotes.
**F9 HR vehicle requests**: five HR users each raise a request (seats, type, cargo capacity); an employee with an open request cannot
raise a second; Logistics assigns a free pool vehicle; when none fits, Finance confirms the budget, then a fleet manager or
administrator approves the purchase, dealer quotations are entered, and adding the vehicle from `/vehicles/new?request=<id>` hands
it over in one step; nobody decides their own.
**F10 Trips (Pro)**: five requesters schedule trips; approve; dispatch with vehicle and driver; clashes (vehicle double-booked, in
the workshop, papers expired); odometer out and back; gate security records exit and entry; send a trip to providers, compare their
quotes beside rate cards, award one, provider invoices through a link, finance checks it.
**F11 Cargo (Pro)**: five cargo requests with weight; vehicle suggestion by capacity, free in the window, and where the last trip
ended; Logistics confirms; with no free vehicle ask chosen providers; turn into a trip; provider quote and invoice; delivered;
WhatsApp notice.
**F12 Users and company settings**: invite by email and by WhatsApp; approve or refuse join requests; role change; deactivate;
every Settings switch saves, survives a reload and changes behaviour (`admin_decides_others`, learner licence, odometer WhatsApp,
send day, policy rules, flags). Toggle `admin_decides_others` both ways and confirm the button is hidden AND the database refuses.
**F13 Activity log, notifications, exports**: activity log (administrator and auditor only) shows who and which fields, never
values, and logs each download; notification lists and counts; every one of the 16 export kinds opens as CSV for each permitted
role and returns 403 for the others.
**F14 Dashboards and reports**: each role's dashboard numbers equal the underlying records; then run Block C of
QA-ALLROLES-REPORTS-PROMPT.md (structure, filters, reconciliation, scope by role) on the data this run created.
**F15 AI and WhatsApp (Pro)**: AI off until the administrator switches it on; document reading drafts only and a person saves;
WhatsApp job card, cargo, trip and odometer menu with the published forms; daily cap per number. Use stubs or the file outboxes;
if neither exists, SKIPPED.
**F16 Billing**: trialing, active, due soon, late, locked, comped, Pro trial (7 days, once). Basic trial length comes from the
plans table (currently 10 days). A locked workspace still allows sign-in, Billing and every export. Basic workspace B refuses Pro
pages by URL.
**F17 Public site and sign-up**: landing, features, compare, pricing (the only page with price figures), about, contact form, terms,
privacy, sign-up, email confirmation, forgot password, robots, sitemap, llms.txt; every link resolves; no price anywhere else; 390px
layout; claims on the page match behaviour.

## 5. Block 4: cross-cutting
Tenant isolation (a workspace B user opens workspace A ids by URL, API route and export: refused, no data in the body); forged
server-action POST with a stale id as each role (a success is Critical); console errors and 5xx on every page; 390px layout on every
form; keyboard use and labels on the main forms; Karachi day boundary (23:30 and 00:30); double-click submit makes one record; back
button after submit; session expiry mid-form; very long and Urdu text; two people editing one card; rate limits on public links.

## 6. Output: `docs/qa/QA-E2E-5USERS-<date>.md` (leave uncommitted)
1. Environment proof and plan, user list (role, count, login worked), counts ok/FAIL/GAP/SKIPPED per block.
2. Function matrix: rows F1 to F17, columns = each role; cell = ran ok, refused correctly, FAIL, GAP or SKIPPED.
3. Findings table: id, severity (Critical = permission bypass, wrong payable, tenant leak, lost audit trail, wrong report total;
   High; Medium; Low), function, user and role, exact steps, expected, actual, screenshot, suspected file or ADR.
4. GAP list with what exists today and a suggested scope. Policy questions where the policy was silent or contradictory.
5. Test data left behind (prefix `QA-E2E-`) and exact steps to remove the QA workspace.
End with a 10-line executive summary. Claim nothing passed that you did not execute in the browser.
