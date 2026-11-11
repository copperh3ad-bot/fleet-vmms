# Fleet OTG: decisions needed before the next build

Written 2026-11-11 from the two full-flow QA runs. Answer by writing the letter next to **Your answer**, or write your own words.
"Suggested" is what I would pick; it is only a suggestion. Items marked (QA F-xx) point to the QA finding.

---

## A. Who may approve and decide what

**A1. The administrator and other people's job cards (QA F-01).**
Today the Tenant Admin can approve a requester's job card, a quotation and an invoice check even when a fleet manager exists.
- a) Admin may decide only their **own** items when alone, and never other people's (strict; the fleet manager approves).
- b) Admin may approve **anything** as now, and the log shows it. (Suggested for small companies.)
- c) Make it a company setting: strict or open, default strict.
Your answer: c

**A2. Logistics and HR vehicle requests (QA F-02).**
Logistics cannot decide HR requests today; only the Admin and Fleet Manager can.
- a) Logistics may give a pool vehicle, but only a Fleet Manager/Admin may approve a **purchase**. (Suggested)
- b) Logistics may do both.
- c) No change.
Your answer: a

**A3. Logistics and trips.**
Logistics can dispatch pool cars and award provider quotes, but cannot approve or reject a trip request.
- a) Logistics may approve and reject trips within the department limit. (Suggested)
- b) Only the Fleet Manager approves; Logistics only dispatches.
Your answer: a

**A4. The auditor.**
The auditor cannot open invoices or cargo, so it cannot check "no payable without a checked invoice" or audit cargo.
- a) Give the auditor **read-only** access to invoices, payments and cargo. (Suggested)
- b) Invoices and payments only.
- c) No change.
Your answer: a

**A5. HR and the fleet list.**
HR cannot see the vehicle list, only its own requests.
- a) HR sees the pool (unassigned vehicles) read-only so it can ask for something that exists. (Suggested)
- b) No change.
Your answer: a

**A6. Requesters and the Vehicles page (QA F-06).**
The permission list grants requesters `vehicle.read` but the Vehicles page refuses them; they see only a dashboard panel.
- a) Requesters see **their own** vehicles on the Vehicles page. (Suggested)
- b) Leave as is and remove the permission from the list.
Your answer: a

---

## B. Payments, follow-up to what was just built

**B1. Who pays.** Today the person who checked an invoice (or approved/raised the card) cannot record its payment.
In a company with one finance person, the Admin records it. Keep this?
- a) Keep. (Suggested)
- b) Let Finance check and pay (no separation).
Your answer: b

**B2. Payment above a limit.** Should a large payment need a second person?
- a) No limit. (Suggested for now)
- b) Above ______ PKR, a Fleet Manager or Admin must approve before it is recorded.
Your answer: b, with 50,000 above 

**B3. Invoices over the approved quote (QA F-10).** Today finance can pay an invoice 22–40% over the quote with just a note.
- a) Over ____ % (suggest 10%) needs a Fleet Manager or Admin to agree first. (Suggested)
- b) Finance decides alone, as now.
Your answer: 10% above needs a

**B4. Tax withholding.** Do you withhold income tax at payment for workshops or providers?
- a) No.  b) Yes, ______ % for ______ (describe which suppliers). Needs the SRB/FBR rule from you.
Your answer: a

**B5. Bank file or reconciliation.** Do you want a bank payment file (CSV for your bank) or a statement match later?
- a) Not now.  b) Bank file, bank name: ______.  c) Reconciliation too.
Your answer: a

---

## C. Quotations and workshop KPIs

**C1. Several workshops per job card (QA F-06).** Today each card gets one workshop quote, so nothing can be compared.
- a) Ask 2–3 workshops per card and compare side by side, with the scorecard beside each quote. (Suggested)
- b) Only above ____ PKR; below it one workshop is fine.
- c) Keep one workshop per card.
Your answer: a

**C2. What the scorecard shows.** Tick the measures you want beside a quote:
[x] average days  [x] quote vs final bill  [x] rework/repeat repairs  [x] number of jobs  [x] on-time  [x] rating by fleet manager  [ ] other: ______

**C3. Quotes far above the estimate or budget (QA F-09).** Today they can be approved with no warning.
- a) Warn when a quote is over ____ % of the estimate or would exceed the vehicle budget; approval needs a written reason. (Suggested)
- b) Block it above ____ %.
- c) No change.
Your answer: a

**C4. Who judges the workshops.** Who may rate or flag a workshop, and how long does a record count?
Your answer: fleet manager

---

## D. Pool vehicles and assignment

**D1. Warnings when assigning (QA F-07/F-08).** Pool cars with expired papers or an open repair were assigned to trips and HR requests with no warning.
- a) **Block** if insurance/fitness/token tax is expired or the vehicle is in the workshop. (Suggested)
- b) Warn only; the person may continue with a reason.
Your answer: b

**D2. Seats, capacity and papers on vehicles (QA F-14).** To match a request to a vehicle, which fields must a vehicle have?
[x] seats  [x] load capacity (kg)  [ ] fuel type  [x] type/class  [x] location (depot/city)  [ ] other: ______
Your answer: ___

---

## E. HR asks for a new vehicle (purchase booking)

Today HR requests, and an Admin/Fleet Manager can give a pool vehicle or mark "purchase approved". Nothing is booked.

**E1.** When no pool vehicle fits, what should happen?
- a) A **purchase request** is created with budget, needed-by date and who approved, and tracked until the vehicle is added and handed over. (Suggested)
- b) Just a status and a note, as now.

**E2.** Who approves a purchase? [ ] Fleet Manager [ ] Admin [x] Finance [ ] a limit: above ______ PKR needs ______
**E3.** Does Finance need to confirm a budget before approval? Yes
**E4.** Do you need quotations from dealers attached to the purchase? Yes 
**E5.** When the vehicle arrives, should adding it close the request and hand it over automatically? Yes
Your answers: E1 a

---

## F. Cargo: choosing a vehicle automatically

Today: a person asks, Logistics accepts, makes a trip, and picks a vehicle or asks providers. No vehicle is suggested.

**F1.** What should the system do when cargo is requested?
- a) **Suggest** the best free vehicle at or near the loading place and let Logistics confirm. (Suggested)
- b) **Assign** it automatically when exactly one suitable vehicle is free, and ask Logistics otherwise.
- c) Keep it manual.

**F2.** What makes a vehicle "suitable"? [x] load capacity ≥ cargo weight [ ] vehicle class [ ] papers valid [ ] not in workshop [x] free in the time window [ ] other: ______
**F3.** How does the system know where a vehicle is? 
- a) Each vehicle has a **home depot/city** that Logistics keeps updated. (Suggested)
- b) Last trip's destination.
- c) Live tracking (needs a tracker; deferred earlier).
**F4.** If nothing suitable is free, automatically ask the logistics providers for quotes? Yes (chosen list)
**F5.** Your depots/loading locations (list): each tenant adds its own when onboarding.

Your answers: F1 a & c, F3 b,

---

## G. Repeat work and the written policy

**G1. What counts as a repeat (QA F-04).** Today only the same reason within the window. Should it also count:
[x] same vehicle + same workshop within the window  [x] reason "poor previous repair" (any)  [x] same part or service type  [x] other: ______
Window now: 30 days (suggest 60).

**G2. Who pays for a repeat repair?**
- a) The **workshop** repairs it free (warranty) and the invoice is not payable.
- b) Payable only if the workshop explains and a Fleet Manager agrees.
- c) Payable as normal; just flag it.
- d) Depends on the reason: ______
Warranty period for a workshop repair: 7 days.

**G3. Show the policy where decisions are made (QA F-11).** Show the relevant policy rules (accident cover, replacement age, driver's share) on the approval and invoice screens?
- a) Yes, read-only, with the rule and the amount that applies.

**G4. Your real policy.** The QA runs used a sample policy. Please confirm I may read your scanned `Vehicle Policy._0001.pdf` and apply it as the test policy. Yes

**G5. Rejected job cards (QA F-15).** May a rejected card be reopened by the requester with a reason? Yes

---

## H. Settings still without a screen

These exist but no screen shows them. Which should a company administrator control?
- `allow_learner_licence` (accept learner permits for invitations): [x] show  [ ] operator only
- `odometer_whatsapp` (monthly WhatsApp request for readings): [x] show  [ ] operator only
- `odometer_send_day` (day the request is sent): [x] show  [ ] operator only

---

## I. Smaller items

**I1.** Cargo export (CSV) returns an error; probably it never existed. Do you want one? Yes
**I2.** The activity log is operator-only. Should a company see its own, read-only, for the auditor? Yes
**I3.** Workshop-link actions (estimate, invoice) show no named person in history. Show "Workshop name (link)"? Yes
**I4.** The Pro price on the pricing page shows one flat price for every fleet size. Is that final, or are fleet-size bands coming? Bands coming

---

## Order I suggest after your answers
1. A (permissions), because it changes what every later screen allows.
2. D (pool checks) and C1/C3 (compare quotes), which are small and were in your flow.
3. G (repeat work) once G4 is answered.
4. E and F (purchase booking, cargo suggestion), the two larger builds. Answer E and F fully before I scope them.
