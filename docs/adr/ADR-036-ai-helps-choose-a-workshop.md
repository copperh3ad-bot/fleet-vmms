# ADR-036: Workshop performance, and AI that helps choose a workshop (design; not built)

Status: proposed, 2026-10-28. Raised by the owner. Nothing here is built. Phase 2, Pro.

## The ask
When a job needs a workshop, the AI should help choose one using **the estimate, the quotation, and the workshop's performance**, rated on level of service, number of redos,
turnaround time and similar. This belongs with Pro (ADR-035) and follows the rule of ADR-034: **the AI recommends, a person chooses.**

## Two parts, and only the second is AI
1. **A workshop scorecard, worked out from records the system already keeps** (no AI, so no cost per use, and fit for Basic too if the owner wants it there). Per workshop, over a
   chosen period, with the number of jobs behind each figure so a thin record is not read as a fact:
   - **Turnaround:** from work order issued to work completed, and against the days the workshop promised in its estimate.
   - **Redos:** a repeat repair on the same vehicle for the same fault within a set number of days (the system already flags repeat repairs), as a share of jobs.
   - **Estimate accuracy:** the invoice against the approved quotation (extra lines the estimate did not have, and the amount over or under), and how often an invoice had to be returned.
   - **Cost competitiveness:** its quotations against the other quotations on comparable jobs (same reason code).
   - **Level of service:** the one thing the system cannot see. It needs a **short rating from the person who closes the job** (for example 1 to 5 on quality, and on communication), recorded
     with their name. This is a new input and the first thing to decide.
2. **The AI recommendation (Pro).** Given the job (reason, vehicle, urgency), the quotations received, and the scorecards, the AI proposes a ranking with its reasons in plain words
   ("Quick Fix: second cheapest by 4 per cent, finished 2 days faster than promised on its last 11 jobs, 1 redo in 11"), and says when the evidence is thin. It sees only the figures
   it needs, never names of staff. A person still approves the quotation, with the usual named approval.

## Guardrails
- The AI never approves, assigns or pays. It may be wrong or biased by thin data, so every recommendation shows the figures it rests on and the number of jobs behind them.
- Fairness to workshops: a workshop with few jobs is shown as "not enough history", not as poor; scoring rules are written down and shown to the organization.
- The score is the organization's tool for its own workshops. Workshops do not see other organizations' data, and one organization's scorecard never uses another's records.
- Same switches as ADR-034 (plan, administrator consent, the owner's off switch), same logging (`ai_actions`), same limits.

## Decisions needed from the owner before building
1. Who rates the **level of service**, when, and on what questions.
2. How long a record counts (the last 6 or 12 months), and the minimum number of jobs before a figure is shown.
3. Whether the scorecard itself is in Basic or only in Pro.
