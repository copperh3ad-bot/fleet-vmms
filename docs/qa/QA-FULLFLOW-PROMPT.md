# Full-flow QA of Fleet OTG: multi-role end-to-end run

You are the orchestrator of a QA run on Fleet OTG (Next.js + Postgres multi-tenant fleet maintenance and operations app).
Repo: /Users/waqas/Documents/fleet-vmms. Read CLAUDE.md, docs/adr/ (especially 002, 005, 007, 030, 033, 045, 048, 059,
070, 073, 075, 077, 078, 079, 082, 085), e2e/README.md and e2e/lib.mjs before you plan. Your job is to find defects and gaps,
not to fix them. Report faithfully: a step that fails or cannot be done is a FAIL or a GAP, never a pass.

## 0. Hard safety rules (read first, no exceptions)
1. **Environment.** Run only against (a) the local throwaway e2e stack (`bash e2e/run.sh` pattern: database `fleet_vmms_e2e`,
   app on port 3100, mock-supabase on 54399), or (b) one brand-new dedicated workspace named `qa-fullflow-<date>` created with
   scripts/create-workspace.mts on a NON-production database. **Never** use https://www.fleetotg.com, `destinsolutions`, or any
   real customer workspace. If you are unsure which database a connection string points at, stop and report.
2. No deploys, no migrations on live, no Netlify/Supabase production changes. No secrets in files, logs or the report.
3. Respect the project's non-negotiables: tenant data only through src/lib/db/tenant.ts; every action goes through the UI or the
   app's own server actions (so `can()` is exercised). **No raw SQL that bypasses permissions, no generic SQL-exec RPCs.**
   The one exception is fake KPI history (Phase 6): seed it with a script under the scratchpad that imports the repo's own
   service/tenant modules, writes only into the QA workspace, and refuses to run if the target is not the QA workspace.
4. Email and WhatsApp must not leave the machine: use the file outboxes (`ALLOW_FILE_MAILER=1` with a `file:` SMTP_URL, and
   `WHATSAPP_FILE`). Test as the live-like non-superuser DB account (ADR-073). Set platform setting `otp_checks` off in the QA env.
5. The QA workspace must be on the **Pro** plan (trips, cargo, AI and logistics providers are Pro, ADR-085). Use scripts/set-plan.mts.
6. Do not build or change product features. If a required capability does not exist, record a GAP with evidence (route, file,
   ADR, screenshot) and move on. Do not modify files under src/, db/ or tests/.
7. Never commit. Write all artifacts to `<scratchpad>/qa-fullflow/` and the final report to `docs/qa/QA-FULLFLOW-<date>.md`
   (create the file, leave it uncommitted for the owner to review).

## 1. Agent plan and model use
Phases depend on each other, so run them in order; inside a phase, independent work may run in parallel (but the e2e test DB
is single-connection: do not open a second connection inside an open transaction).
- haiku: read-only gathering (list settings, read policy, count rows, collect screenshots, grep for capability).
- sonnet: executing browser flows per role, comparing expected vs actual, writing per-phase findings.
- opus: the final synthesis, policy-vs-behaviour judgement (who pays for repeat work), and severity ranking.
Keep a shared `state.json` (ids of vehicles, job cards, vendors, users). Append evidence (step, expected, actual,
ok/FAIL/GAP/SKIPPED, screenshot path) to `<scratchpad>/qa-fullflow/phase-N.jsonl`.

## 2. Phases

### Phase 1: Setup and roles
- Sign up the company through /signup (the administrator). Create every other account through the real invitation flow
  (Users page), signing each one in and setting its password via its single-use link from the file outbox:
  - 10 requesters (`req01`..`req10`), 1 finance, 1 auditor (read-only), 1 logistics (operating department Logistics, ADR-048/075),
    1 HR, and, because job cards need an approver, 1 fleet manager (ASSUMPTION: the brief lists no approver; say so in the report).
  - Workshops/vendors never sign up (ADR-033): create 4 workshop vendors and 2 third-party logistics providers (ADR-078) and
    drive them only through their single-use links.
- For each role, verify the sidebar and routes match its permissions: record every page it can and cannot open, and attempt one
  forbidden write per role (finance edits a job card, auditor creates anything, requester approves, HR touches job cards).
  A forbidden action that succeeds is a **Critical** finding.

### Phase 2: Fleet master data
- Add 20 vehicles across at least 6 distinct categories offered by the Vehicle form (e.g. car, SUV/jeep, pickup, van, truck,
  bus/coaster, motorbike, loader/forklift on engine hours). Vary make, year, odometer, custody, department, papers expiry.
- Assign 2 vehicles to each requester as custodian. Use both the Excel import (ADR-038) for 10 vehicles and the form for 10.
- Check: duplicate registration rejected, dates dd/mm/yy (ADR-060), papers reminders appear.

### Phase 3: Job cards within and outside limits
- First read the company's maintenance policy and settings (approval limits, `dept_approval_limit`, repeat window `flag_repeat_days`,
  budgets, driver's share) and write the thresholds into state.json. Do not assume numbers.
- Each requester raises a job card for each of their 2 vehicles = 20 cards. Make roughly half **within** the approved limit and
  half **outside** it (and include some exceeding the vehicle budget, and some for accidents the policy does not cover).
  Use varied reason codes (scheduled service, wear and tear, driver misuse, accident damage, defect, poor previous repair, environmental).
- Check: requester cannot approve their own card; every step writes `job_card_events` with person and time; budget and vehicle flags fire.

### Phase 4: Approval and rejection per policy
- The fleet manager (and administrator where policy says so) approves or rejects each card **as the written policy dictates**.
  Derive the expected decision for each card yourself from the policy BEFORE deciding, record it, then compare with what the system
  allows or forces (e.g. over-limit needs a higher approver; rule B/ADR-077 self-decision only as sole employee).
- Rejected cards must stop; approved ones go to quotation. Test rejection with and without a reason, and a request to reopen.

### Phase 5: Vendor quotations
- Each approved card gets quotes from 2-3 workshops via their single-use links (ADR-030): vary price, days, and one quote far
  above the card estimate. Test link single-use, expiry, wrong-link reuse, and an emailed reply filed on the card (ADR-033).
- Pro AI quote advice (ADR-080) and AI document reading (ADR-034): run only if the QA env has a stub or an allowed API key;
  otherwise mark SKIPPED, not passed.

### Phase 6: Vendor KPI and quotation judgement
- Seed fake but realistic KPI history for the workshops (jobs, average days, quote-vs-bill %, rework %, a few repeat repairs) using
  the script rule in section 0.3. Make the numbers differ enough that the best and worst workshops are obvious.
- Judge each quotation against the scorecard (Vendors scorecard, ADR-036, src/lib/jobcards/service.ts vendors stats). Check the
  system shows KPIs beside the quote; check that the chosen quote, the cheapest quote and the best-KPI workshop can differ and the
  UI makes that visible. Record where the scorecard is missing or misleading.
- Award quotes; confirm work order issued, work done, workshop sends invoice by link, invoice is checked against the approved
  quotation (an invoice above quote must be flagged and must not be silently payable).

### Phase 7: HR vehicle requests (ADR-059)
- HR raises 3-4 requests for new vehicles for employees (different needs: seats, type, cargo capacity). One employee already has an
  open request: confirm a second is refused.
- Logistics decides which pool vehicles meet each need. Assign suitable ones; for a need the pool cannot meet, check whether the
  system can place a **booking/request to purchase a new vehicle**. A `purchase_approved` status exists; the full purchase booking is
  reported by the owner as "needs to be built": test what exists, and write a precise GAP (what is missing, what the owner described).

### Phase 8: Trips (ADR-045, Pro)
- Requesters schedule trips A to B (different dates, passengers/load). Logistics assigns a vehicle and driver from the pool; check
  clashes (same vehicle double-booked, vehicle in the workshop, vehicle with expired papers), odometer out and back, and the trip
  status trail. Also send one trip to the third-party providers for quotes and award it (ADR-078).

### Phase 9: Cargo (ADR-079/085, Pro)
- Requesters ask for cargo pick-up and delivery A to B. Expected by the owner: the system decides whether any **vacant vehicle at
  one of the loading locations** exists, otherwise raises a request to a third party. Verify whether the system does any
  location-aware or availability-aware decision at all, or only a manual accept/schedule. Report exactly what happens and GAP the rest.
- Test turn-into-trip, the provider quote/invoice path, and the WhatsApp notice (file outbox).

### Phase 10: Payments
- Finance pays workshop invoices and logistics-provider invoices. Test: pay a checked invoice; refuse an unchecked/over-quote
  invoice; double payment attempt; partial payment if supported; payment recorded against the right vehicle, department and budget;
  exports/reports reflect it. A payable that should not be payable but is = **Critical**.

### Phase 11: Repeat work
- A requester raises a new job card for the same fault on a vehicle inside the repeat window (`flag_repeat_days`), same workshop
  and also a different workshop, with reason "poor previous repair" and also "wear and tear". Confirm the repeat flag and the
  "why it keeps breaking" report.
- Decide, **from the written maintenance policy and ADRs, not from guesswork**, whether the invoice for the repeat work is payable
  to the workshop, to the driver, or the company. Record the policy clause, the expected answer, and what the system does when
  finance tries to pay. If the policy is silent or the system lets it through unflagged, that is a finding.

### Phase 12: Audit
- The auditor (read-only) verifies the whole run against the company SOP/policy: every approval has a different person than the
  requester; every state change has an event with person and time (`job_card_events`, activity log ADR-070); quote vs invoice
  checks; no payable without a checked invoice; budgets and limits respected; workshop and provider records complete; pool vs
  assignment logic consistent; one-phone-one-organization (ADR-082). The auditor lists any exception and attempts no writes
  (confirm writes are refused). Produce the audit sheet: control, evidence, result, exception.

## 3. Cross-cutting checks (run alongside)
- Tenant isolation: from a second QA workspace, try to reach the first workspace's ids by URL; must be refused.
- Mobile (390px) pass on the job card, quotation, trip and cargo forms for the requester and logistics roles.
- Browser console errors, failed requests, 5xx on every page visited; accessibility basics (labels, focus, contrast on forms).
- Notifications and reminders (file outbox) sent to the right people and not to anyone else.
- Exports (Excel/CSV) open and totals match the screen.

## 4. Output
Write `docs/qa/QA-FULLFLOW-<date>.md` with:
1. Run summary: environment used (prove it was not production), plan, counts of steps ok/FAIL/GAP/SKIPPED.
2. Findings table: id, severity (Critical/High/Med/Low), phase, role, steps to reproduce, expected, actual, evidence path,
   suspected area (file/ADR). Critical = permission bypass, wrong payable, tenant leak, lost audit trail.
3. GAP list: capabilities the owner described that do not exist or only partly exist (at minimum: purchase booking from an HR
   request, vacant-vehicle-at-location cargo decision), each with what exists today and a one-paragraph suggested scope.
4. Policy questions the owner must answer (anything where the policy was silent or contradictory).
5. Audit sheet from Phase 12.
6. Test data left behind (prefix `QA-FF-`) and how to remove the QA workspace.
End with a 10-line executive summary. Do not claim anything passed that you did not execute.
