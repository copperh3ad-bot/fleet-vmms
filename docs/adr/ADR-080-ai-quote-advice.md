# ADR-080: The AI compares the quotes on a trip (advice only)

Status: accepted, 2026-11-09 (owner decisions: recommend only; weigh price against the company's rate cards, the provider's history, and vehicle fit with lead time; providers keep using links only, no provider login).

## Context
ADR-078 lets a Pro company send one trip to several logistics providers and award one quote. With many quotes the manager has to weigh price, the company's own rate cards, how each provider has performed, and whether the vehicle offered fits. The AI can do that weighing, as it already reads workshop documents (ADR-034) and policies (ADR-043).

## Decision
- A **Compare with AI** button on a trip waiting for approval, once at least two providers have quoted. It is a Pro feature (needs the plan's AI and outsourced-trips features) and runs only when the organization's administrator has switched the AI on, within the same trial allowance and daily and hourly limits as reading documents.
- **Advice only.** The AI ranks the quoted options best first, with a reason and any concerns for each, a two-sentence summary and warnings (for example "no rate card"). It never awards, never edits a quote, never contacts a provider. Awarding is the person's click through `awardTripQuote`, which runs the same `trip.award` and segregation-of-duties checks as before (ADR-077).
- **What it weighs:** (1) price against the company's reference rate cards for that provider; (2) the provider's history with this company: trips completed, invoices returned, invoices billed above the award, quotes given and declined, usual time to answer; (3) fit: vehicle offered against passengers and preferred vehicle, start time, validity. The server computes the figures (for example the percentage over the lowest quote); the AI reasons over them.
- **Privacy:** the model sees options labelled A, B, C. No provider names, no people's names. The route, purpose, passengers, quote figures, rate card labels and history counts are sent. The server maps letters back to quotes and discards any letter it did not send.
- **Stored and logged:** every use is a row in `ai_actions` (kind `quote_advice`, anchored to the trip) with model, tokens and status; the checked advice is its `draft`. The trip page shows the latest advice and marks it **stale** when a quote has been added, corrected or withdrawn since, so it is not relied on after the facts change.
- Providers get no sign-in; they keep the single-use links of ADR-078.

## Consequences
- Tenant migration 0050 adds `ai_actions.trip_id` and the `quote_advice` kind.
- The AI still talks to the provider in one file only (`src/lib/ai/claude.ts`, `adviseQuotes`). The prompt treats all input as data, never instructions.
- Auto-awarding was considered and rejected: it would let a model spend money and would weaken segregation of duties.
