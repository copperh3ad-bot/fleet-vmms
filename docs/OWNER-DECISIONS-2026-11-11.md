# Owner decisions, 2026-11-11

Answers to `docs/QUESTIONNAIRE-BUILD-DECISIONS.md`, written down so the build follows them. "Owner" means the product owner. Items marked OPEN were
not answered or conflict with something already built; they are listed at the bottom.

## A. Approvals and roles
Built 2026-11-11 as ADR-088 (migration 0054); not deployed.
| # | Decision |
|---|---|
| A1 | Make it a **company setting**: the administrator may decide other people's job cards, quotations and invoice checks ("open") or not ("strict"). Default **strict**. Strict applies **only while another active person holds the permission**; a company with no other approver is not blocked (answered Q1). |
| A2 | Logistics may **give a pool vehicle** on an HR request. Only a Fleet Manager or Admin approves a **purchase**. (Purchases: see E2.) |
| A3 | Logistics may **approve and reject trips** within the department limit. |
| A4 | The auditor gets **read-only** access to invoices, payments and cargo. |
| A5 | HR sees the **pool** (unassigned vehicles), read-only. |
| A6 | Requesters see **their own** vehicles on the Vehicles page. |

## B. Payments (follow-up to ADR-086)
| # | Decision |
|---|---|
| B1 | **Finance may check and pay the same invoice** (no checker/payer separation). This reverses a rule built in ADR-086. Separation moves to amounts (B2, B3). |
| B2 | A payment **above 50,000 PKR** needs a Fleet Manager or Admin to approve before it is recorded. |
| B3 | An invoice **more than 10% above the approved quote** needs a Fleet Manager or Admin to agree before Finance can pay it. |
| B4 | No tax withholding at payment. |
| B5 | No bank file or reconciliation now. |

## C. Quotations and KPIs
| # | Decision |
|---|---|
| C1 | Ask **2 to 3 workshops per job card** and compare side by side, with the scorecard beside each quote. |
| C2 | Scorecard shows: average days, quote vs final bill, rework/repeat repairs, number of jobs, on-time, rating by fleet manager. |
| C3 | **Warn** when a quote is over the estimate (**10%** over the estimate, answered Q6) or would exceed the vehicle budget; approval needs a written reason. |
| C4 | The **Fleet Manager** rates and flags workshops. A record counts for the **last 12 months** (answered Q4). |

## D. Pool vehicles
| # | Decision |
|---|---|
| D1 | **Warn only**: expired papers or an open repair show a warning, and the person may continue with a written reason. |
| D2 | A vehicle carries: seats, load capacity (kg), type/class, location (depot or city). Not fuel type. |

## E. HR purchase booking
| # | Decision |
|---|---|
| E1 | When no pool vehicle fits, a **purchase request** is created with budget, needed-by date and approver, and tracked until the vehicle is added and handed over. |
| E2 | **Finance confirms the budget, then a Fleet Manager or Admin approves** the purchase (answered Q5). |
| E3 | Finance **confirms a budget** before approval. |
| E4 | **Dealer quotations** are attached to the purchase. |
| E5 | Adding the vehicle **closes the request and hands it over automatically**. |

## F. Cargo
| # | Decision |
|---|---|
| F1 | The system **suggests** the best free vehicle; Logistics confirms and assigns manually ("a & c"). It does not assign by itself. |
| F2 | Suitable = load capacity at least the cargo weight, and free in the time window. |
| F3 | A vehicle's location is **where its last trip ended** (not a home depot, not live tracking). |
| F4 | If nothing suitable is free, ask a **chosen list** of logistics providers for quotes. |
| F5 | Each organization adds its own depots/locations during onboarding. |

## G. Repeat work and policy
| # | Decision |
|---|---|
| G1 | A repeat is: same vehicle and same workshop within the window; or reason "poor previous repair" (any); or same part or service type. Window **30 days**. |
| G2 | Warranty period for a workshop repair: **7 days**. Who pays for a repeat repair: **depends on the reason** (answered Q2). The owner has not yet given the rule; proposed default, to be confirmed: reasons "poor previous repair" and "defect" inside the warranty are the workshop's to redo free (invoice not payable, a Fleet Manager may override with a reason); wear and tear, environmental, accident and driver misuse are payable and flagged. |
| G3 | Show the relevant policy rules read-only on the approval and invoice screens, with the rule and the amount that applies. |
| G4 | The assistant **may read** `Vehicle Policy._0001.pdf` and use it as the test policy. |
| G5 | A requester **may reopen a rejected job card** with a reason. |

## H. Settings with a screen
Company administrators control `allow_learner_licence`, `odometer_whatsapp` and `odometer_send_day`. (Admin settings screens to be extended.)

## I. Smaller items
I1 build a cargo CSV export. I2 a company sees its own activity log, read-only, for the auditor. I3 workshop-link actions show "Workshop name (link)" in history.
I4 Pro pricing: **fleet-size bands are coming**, so the flat price on the pricing page is not final.

## Open items
- **G2** the exact rule per reason (a default is proposed above and must be confirmed before it is built).

## Conflicts with what is already built
- **ADR-086** says the checker cannot record the payment. B1 reverses that. Build: remove that check, add B2 and B3, update the ADR.
- **ADR-075/077** and the current permission table let the administrator decide others' items. A1 makes it a setting, default strict, which changes
  behaviour for existing companies on the next deploy (they become strict).
- **I4** flat Pro price is already live on the pricing page.
