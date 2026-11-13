# QA prompt: Basic versus Pro, a plan-by-plan matrix, run twice, with a verifiable ledger

Use this together with `docs/qa/QA-BASIC-PRO-LEDGER-PROMPT.md`. That file defines the environment gate (section 0), the hash-chained
input ledger (section 1), the cast, the database verification and the verdict rules, and they all apply unchanged. **This file
replaces its sections 4 and 5 with one matrix that says, for every feature, exactly what Basic must do and exactly what Pro must
do.** A feature is only PASS when the plan's own expected result happened, including when the expected result is "closed".

Pull master first (`git pull`). You need commit `e7447f4` or later: it fixes F-02 (a Basic workspace opening Trips must see the Pro
sentence, not the module switch). Earlier findings F-01 (plan never reached the runtime) and F-02 are claimed fixed; re-prove both.

## A. How the plans differ (the source of truth for every expectation below)

| | Basic (`plans.key = standard`) | Pro (`plans.key = pro`) |
|---|---|---|
| Plan flag in the database | `features.fleet_ops = false` | `features.fleet_ops = true` |
| What it is | Maintenance management: vehicles, papers, odometer, reminders, job cards, quotations, invoices, vendors, HR requests, accidents, reports | Everything in Basic, plus fleet operations and AI |
| Trial | `plans.trial_days` (10 on live, read it from the table, do not assume) | 7 days, offered once (`PRO_TRIAL_DAYS`) |
| Trips (schedule, approve, dispatch, gate exit and entry, outsourced trips, provider quotes and invoices) | **Closed** | Open |
| Cargo requests (weight, volume, suggestion, logistics handling) | **Closed** | Open |
| Logistics providers and their rate cards (Vendors page) | **Closed** | Open |
| Reading workshop documents with AI | **Closed** | Open once the administrator switches it on |
| Raising job cards by WhatsApp | **Closed** | Open once the administrator switches it on |
| WhatsApp menu (job card, cargo, trip, odometer by forms) | **Closed** | Open once the administrator switches it on |
| Price | One price | Bands by fleet size (owner enters them; if none are entered Pro is "not for sale", which is expected, record it) |

Exact sentences the app uses. Quote what you saw next to these:

- Plan gate on Trips and Cargo pages and actions: **"Trip scheduling and cargo requests are part of the Pro plan. Your administrator can upgrade in Billing."**
- Vendors page, AI panel on Basic: "This is part of the Pro plan: the AI reads the estimates and invoices your workshops email..." with a link to Billing.
- Vendors page, WhatsApp menu panel on Basic: "This is part of the Pro plan: employees say Hi on WhatsApp and choose what to do..."
- Switching AI reading on: refused on Basic ("Reading with AI is part of the Pro plan...").
- Switching WhatsApp job cards on: "Job cards by WhatsApp are part of the Pro plan."
- Switching the WhatsApp menu on: "The WhatsApp menu is part of the Pro plan."
- Module switch message (Pro only, when Trips is off in Settings): "Trips are not switched on for this organization..." **Basic must never show this**, whatever the Settings switch says.

## B. Setup, per plan

Two workspaces on the stack from section 0 of the ledger prompt: `qa-led-basic` on `standard` and `qa-led-pro` on `pro`. Prove, in the
database, before any user step, and write the output into the ledger as block 0:

1. `plans.features->>'fleet_ops'` is false for `standard`, true for `pro`; read `plans.trial_days` for both.
2. `org_billing.plan_key` and `tenant_subscriptions.plan_key` agree for each workspace, and neither is in a Pro trial.
3. Both workspaces have `module_trips` set **On** in Settings (this is the trap that produced F-02: Basic must still stay closed).

Cast per workspace (same as the ledger prompt): every role at least once, at least 3 requesters, 2 fleet managers, 3 workshops;
Pro also 3 logistics providers. Onboard each person once: invite, then accept the **newest** link at once. Do not click "Send a new
link" and then use the old link (a new link revokes the old one, ADR-012); that mistake stopped the last run at 5 of 50 people.
Vehicles: 4 per category on Pro, 8 on Basic, by form and by Excel import. Give every cargo-capable vehicle on Pro a load capacity
(kg) and load space (m3); leave two with none.

## C. The matrix. Run every row for Basic, then every row for Pro

Write the `expected` for the plan before the step, run it, log it, verify in the database. Columns: **B** = Basic must, **P** = Pro must.

### C1. Open on both plans (same behaviour, prove it twice)

| # | Feature | B and P must |
|---|---|---|
| 1 | Public site, sign-up, contact form | Contact message stored in Admin, Messages AND an email in the file outbox to the settings address with Reply-To = sender; a mail failure never loses the message |
| 2 | Users, roles, invitations, join code, role change, deactivate | As ledger prompt section 4.3, including `admin_decides_others` both ways |
| 3 | Vehicles, departments, depots, budgets, service rules, papers, employees | Vehicle load capacity (kg) and load space (m3) can be saved on the vehicle page and at creation, empty clears, a bad value is refused. They are plain vehicle fields on **both** plans |
| 4 | Odometer by link and review screen | Lower reading refused, jump flagged |
| 5 | Reminders at 30, 14, 7, 0 days | One message per threshold |
| 6 | Job cards: ten work kinds, limits, budgets, approvals, reopen, history | Nobody approves their own |
| 7 | Repeat work and warranty note | Flag inside `flag_repeat_days`, payer and reason mandatory |
| 8 | Policy on screen | Numbers change with `policy_*` settings |
| 9 | Quotations through single-use links, work orders | Reuse and expiry refused |
| 10 | Invoices and payments | Checker is not approver, payer is not checker, over-limit rules, partial and double payment |
| 11 | Workshop vendors, ratings, scorecards | Workshop rate cards and KPI work |
| 12 | HR vehicle requests | One open request per employee |
| 13 | Accidents, challans, compliance | |
| 14 | Reports, every CSV export, activity log | 403 for roles without the permission, log line per download |
| 15 | Billing screen | Trial days equal `plans.trial_days`, due soon, late, locked (sign-in, Billing, exports still work) |

### C2. Closed on Basic, open on Pro (the differentiators; do the deepest checking here)

For each row, on **Basic** run all four doors: (a) the sidebar, (b) the page by typing the URL, (c) a direct POST of the server action
as a permitted role, (d) the CSV export. Expected on Basic: the page shows the plan sentence, the sidebar entry is absent, the POST is
refused with the plan sentence, **and the database has no new row**. Prove the "no new row" with a before and after count in the ledger.
On **Pro** run the full feature.

| # | Feature | Basic must (closed) | Pro must (open) |
|---|---|---|---|
| 16 | Trips, list page `/trips` with Trips switched On in Settings | Plan sentence, never the module-switch message (F-02) | Real Trips screen |
| 17 | Trips, new, detail, outsourced pages | Plan sentence on each | Open |
| 18 | Trips, full flow: schedule, approve, dispatch with vehicle and driver, clashes (double-booked, in workshop, papers expired), odometer out and back, gate exit and entry | Request refused, no `trips` row | Works, every state change in the event history |
| 19 | Trips outsourced: send to providers, provider quote by link, compare beside rate cards, award, provider invoice by link, finance check | Closed, no rows in provider tables | Works, award and invoice amounts reconcile |
| 20 | Cargo: sidebar, `/cargo`, `/cargo/new` | No sidebar entry, plan sentence | Open |
| 21 | Cargo request with weight (kg) and optional volume (m3), by the app form | Forged POST as a Basic requester refused, **no `cargo_requests` row** | Stored exactly, shown on the card ("Volume" in m3) and in the cargo CSV (`Volume m3` column) |
| 22 | Cargo by the published WhatsApp form (stubs or the file outbox) and by the typed chat, which asks volume as an optional step after weight (reply SKIP leaves it empty; bad number refused) | Menu closed, nothing written | Weight and volume stored; the chat and the form give the same row |
| 23 | Cargo vehicle suggestion | Not reachable | Suggests by weight; a vehicle whose recorded space is smaller than the load is dropped; a vehicle with no space recorded stays with the note "load space not recorded, check it fits"; no weight capacity recorded is counted. Test the edges: volume exactly equal to space (kept), 0.01 over (dropped) |
| 24 | Cargo handling: logistics confirms, turns it into a trip, provider quote, invoice, delivered, WhatsApp notice | Closed | Works end to end |
| 25 | Logistics providers and rate cards (Vendors page) | Section not offered | Add, rate card per basis, KPI beside quotes |
| 26 | AI document reading (estimates, invoices) | AI panel shows the Pro paragraph; administrator cannot switch it on; "Read with AI" button absent; forced call refused with "Reading with AI is part of the Pro plan..." | Off until the administrator switches it on; then drafts only, a person saves; a reading is logged; per-person hourly limit and per-organization daily cap enforced (count them) |
| 27 | Job cards by WhatsApp | Cannot be switched on ("Job cards by WhatsApp are part of the Pro plan.") | Switch on records who and when; message creates a draft the person confirms |
| 28 | WhatsApp menu (job card, cargo, trip, odometer) | Menu closed; cannot be switched on ("The WhatsApp menu is part of the Pro plan."); inbound message gets no menu | On once switched; each flow through the published form; daily cap. If neither stub nor file exists record SKIPPED, not PASS |

**AI panel visibility (learned from the last run).** The "Reading workshop documents with AI" panel on the Vendors page is shown only
to an administrator and only when the server has AI configured (`aiConfigured()`). With no AI key or stub on the stack the panel is
hidden on **both** plans, which is by design and not a defect. Before rows 26 and 27, set an AI key or the stack's AI stub and
record which. If neither exists, record rows 26 and 27 as SKIPPED with the reason "AI not configured", never PASS or FAIL. The
WhatsApp menu panel needs only the administrator check, so it shows on both plans. Your classifier must look for the Basic
sentences quoted in section A, not for a "real screen" marker: the Vendors page has none, and a missing marker is not a FAIL.

### C3. Moving between plans (this is where money and access change)

Do these in order on a **third** pair of workspaces so the first two keep their baseline:

29. Basic workspace: Billing offers Pro and states the Pro trial (7 days, once). If the owner entered no bands, Pro says not for sale: expected, record it, and use the operator tool `scripts/set-plan.mts` to continue.
30. Start the Pro trial: Trips, Cargo, AI and WhatsApp open at once; `org_billing.plan_key` = pro; trial end date = start + 7 days; a `plan_changes` row.
31. Trial offered a second time: refused. Trial end: reverts to Basic, **and every Pro surface closes again** (re-run rows 16, 20, 26, 28 and expect the Basic result), existing trips and cargo rows stay in the database and stay readable by export according to the app's own message.
32. Pay for Pro: the quote follows the band for the fleet count (add vehicles across a band boundary and confirm the price changes at the right count, from `plan_bands`, not from anything built in), payment claim, confirmation, invoice, plan switch at once or at period end exactly as the screen states. Record every amount in `money.csv`.
33. Downgrade Pro to Basic: scheduled for the end of the paid period; until then Pro stays open; at the switch Pro closes (`shutOffPro`), AI and WhatsApp switches turn off, and re-enabling is refused.
34. Operator tooling: `scripts/set-plan.mts` and `scripts/create-workspace.mts --plan` must leave `org_billing.plan_key` equal to `tenant_subscriptions.plan_key` (F-01). Check both tables after each run.

### C4. Cross-plan isolation

35. A Pro user's session on the Pro workspace cannot reach `/w/<basic-slug>/cargo`; a Basic admin typing a Pro workspace slug is refused.
36. Cargo and trip rows created on Pro never appear in any Basic report, export or count (verify by schema, not only by screen).
37. Switching a workspace's plan changes **only** that workspace (check the other workspaces' `org_billing` rows before and after).

## D. Evidence rules (same ledger, stricter on closed features)

- Every closed-feature check logs the **sentence seen**, a screenshot, and the **row count before and after** for the tables that would
  have changed (`trips`, `cargo_requests`, provider tables, AI usage log). A closed feature that wrote a row is a Blocker.
- Every open-feature check logs the exact inputs typed (weights, volumes, amounts, dates, uploads by SHA-256), the ids the app
  returned, and the expected result written before the step.
- Run `verify.sql` after each block as the ledger prompt says: matched, MISSING, MISMATCH, EXTRA. Money totals in `money.csv` must
  reconcile to the database to the paisa.
- Skeptic pass: 25 random ledger rows re-checked three ways (what was typed, what the page shows, what the table holds), at least 8
  of them from the closed-on-Basic rows.

## E. Output

Write `docs/qa/QA-PLAN-MATRIX-<date>.md`, leave it uncommitted. Required contents:

1. Environment proof, commit, plan proof (block 0), ledger final hashes for every block.
2. **Two result tables, one for Basic and one for Pro**, one line per matrix row (1 to 37), status PASS, FAIL or SKIPPED, the expected
   and the actual in one sentence, ledger seq numbers and screenshot names. Never leave a row blank.
3. **A difference table**: for rows 16 to 28, Basic result next to Pro result, so the owner sees the split at a glance.
4. Findings with severity (Blocker: a closed feature wrote data or leaked, money or permission wrong; High: a Pro feature closed on Pro
   or a Basic feature closed on Basic; Medium: wrong message or dead end; Low: cosmetic), steps, expected, actual, ledger seq, suspected file.
5. Counts: rows run, PASS, FAIL, SKIPPED per plan; verification CSV totals.
6. Verdict: GO only if no Blocker or High, every row ran on both plans (or has a reasoned SKIPPED that cannot affect the verdict), the
   ledger chains verify and the database reconciles. Otherwise GO WITH CONDITIONS or NO-GO. Do not issue GO on a partial run; say how much
   was executed.

Do not commit, deploy, send real email or WhatsApp, or open any customer workspace. Production only under the exact sentence in
section 0 of the ledger prompt.
