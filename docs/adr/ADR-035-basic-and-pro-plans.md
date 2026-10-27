# ADR-035: Basic and Pro plans

Status: accepted, 2026-10-28. Amends ADR-014 and CLAUDE.md rule 7 (one plan, one price) with the owner's authority: there are now two plans.

## Decision
1. **Two plans.** **Basic** is the existing `standard` plan, renamed: same key, same price, same customers, every feature, nothing taken from anyone. **Pro** is Basic plus
   the AI features (ADR-034 and what follows).
2. **Rollout.** **Phase 1: Basic is the default and the only plan on sale.** Sign-up stays exactly as it is. **Phase 2: Pro is offered as an upgrade to existing
   organizations that enter more than 20 job cards a day** (the owner's setting `pro_offer_min_job_cards`, 20 when empty), measured as the average per day over the last 30 days.
   Job cards, not vehicles, because each repair brings an estimate and an invoice for the AI to read, so volume is what the AI's work and cost follow. Pro's *price* still follows fleet size (below). It is not offered at sign-up. Until the owner enters Pro's
   bands, the Pricing page says Pro is coming in the second phase and shows no amount.
3. **Every price is the owner's and lives in the database, never in code** (rule 7). Basic's price is `plans.price_cents`. **Pro is priced in fleet-size bands**
   (`plan_bands`): a fleet of 1 to N vehicles pays one price, N+1 to M another, and the last band has no upper limit so every fleet has a price. The reason is cost:
   a larger fleet raises more estimates and invoices, so more documents are read. Each band also sets the **AI readings per day** that organization may make. The owner
   edits all of it on the **Plans** page in Admin. A test fails if an amount appears in the plan code, the pricing page, the Admin page or the FAQ.
4. **An organization's band is worked out from its number of vehicles when it joins Pro or renews, and it keeps that price and allowance until then** (`org_billing.price_cents`
   and `ai_reads_per_day` are copies), so a later change to the bands touches nobody already paying. The operator can re-band an organization whose fleet has grown.
5. **What the plan decides.** `plans.features.ai_documents` allows the AI. The server checks the plan on every AI request (hiding a button is never the only guard). An organization
   on Basic, or on no plan (those that existed before billing), has no AI. A **trial on Pro** gets a small taste (`limits.ai_trial_reads`, 10 in all); paying lifts it. The
   organization's administrator must still switch the AI on (ADR-034), and the owner can switch the whole service off (`AI_DOCUMENT_READING=off`).
6. **The owner can try Pro now:** waive billing on their own organization (it then needs no price) and move it to Pro from its page in Admin.

## Step 2, not built yet: moving between plans by paying
The agreed rule is that the plan a customer pays for is the plan it has once the payment is confirmed: Billing offers Pro only to organizations above the threshold, a payment claim
names the plan (`payment_claims.plan_key`, added), and confirming it switches the plan and takes the band's price and allowance (invoice, tax and ledger use that price). Downgrade is
the same in reverse. A trial can switch immediately. This touches invoicing and the ledger, so it is its own change with its own tests, after Phase 1 is live and Pro has its bands.

## Operator checklist
Plans page in Admin: confirm Basic's price; leave Pro's bands empty until Phase 2; set "Pro is offered above this many vehicles" in Settings if not 20.
Migrations: control 0015 (plans, bands, org_billing column, claim column) and the ones already listed.
