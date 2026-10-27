# ADR-034: The AI reads workshop documents; a person approves

Status: accepted, 2026-10-28. First step of an AI layer under the product. This is a separate stream from the non-AI work tagged `fleet-otg-non-ai-developments`.

## Decision
1. **Authority: drafts, a person approves.** The AI does the reading, matching and drafting. It never saves, approves, pays or changes a job card. A person checks
   the draft and presses save, through the same form and the same database function as when the figures are typed in (ADR-033), so every rule, permission and
   separation of duties still applies and every approval still carries a named person and a time. Auto-approval within limits and full autonomy were considered
   and not chosen: they would put "AI" where the product's value is a named person, and need legal and audit review first.
2. **First capability: reading an emailed estimate or invoice** (PDF or photo). Staff press "Read the attached file with AI" on the job card's entry page; the
   form is filled as a draft with a clear notice, every doubt listed as a warning, and the history of the job card says *read by AI and checked by <name>*.
3. **Provider and model.** The Claude API through the official SDK (`@anthropic-ai/sdk`), in one file (`src/lib/ai/claude.ts`). The model is the cheapest
   current one that reads a PDF or a photo, **Claude Haiku 5.5**, because copying printed figures for a person to check does not need a larger one. The owner
   can set another in Netlify (`AI_MODEL`). Whether Haiku is good enough is measured, not assumed: every draft records whether the person saved it unchanged
   or corrected it (`ai_actions.outcome`). **Prompt caching is on:** one breakpoint on the fixed instructions and one on the last file, so a second reading of
   the same file within five minutes (a retry, or a second person) reuses it; the job's own facts come after both so they never break the cached part; cache
   writes and reads are recorded per action.
4. **What is sent, and what is not.** Only the file, the job card number, the kind asked for, the company's currency and, for an invoice, the lines of the
   approved estimate. No names of people, no vehicle, no other job, no other company. The model gets no tools and cannot act. Its answer is JSON in a fixed
   schema (structured outputs; no forced tool choice, which this model family refuses). Anthropic's API terms do not train on this data.
5. **The answer is data, never an instruction.** The document comes from outside, so the system prompt says to treat it as text to copy; and independently of
   the model, `src/lib/ai/document.ts` checks everything before a person sees it: figures must be numbers in range, an invoice line can only be matched to an
   approved line id we supplied, the lines must add up to the printed total (a warning if not), the currency and kind of document must match (a warning if not),
   an unreadable file is shown as unreadable and never as a draft. A test feeds it a document that tries to give orders.
6. **The organization decides.** It is **off** until the organization's administrator switches it on (Vendors page), which records who and when
   (`tenants.ai_consent_by/at`), because the documents are sent to a provider. The owner can switch the whole service off (`AI_DOCUMENT_READING=off`), and
   there is no key, no feature. Only people who may already enter these figures can use it, only on files that came with a workshop's reply to that job card.
7. **Limits and records.** 60 readings per organization per day and 20 per person per hour. Every use is one row in `ai_actions` (audited): who asked, which
   model, what it returned, tokens, cache use, and what became of it. A failure, a refusal or an unreadable file is shown plainly and staff type it in.
8. **No other AI use of customer data.** Not for training, not for analytics, not for advertising. The Privacy policy names Anthropic as a provider, only for this.

## Cost
Haiku 5.5 is $0.10 in / $0.50 out per million tokens. A typical one-page document is a few thousand tokens in and about one thousand out: well under one US
cent per reading. The 60-a-day cap bounds the worst case per organization to a few cents a day.

## Not done, on purpose
- No automatic reading when a reply arrives (staff press the button; no cost for replies nobody needs read).
- No auto-approval, no AI payment decisions, no AI messages to workshops or drivers. These are later steps and each needs its own decision.
- The remaining ideas from the design discussion (invoice-versus-estimate checks, chasing, triage, briefings) are not started.

## Owner set-up (docs/OPERATIONS.md, "AI reading of workshop documents")
`ANTHROPIC_API_KEY` in Netlify (secret), optional `AI_MODEL`, optional `AI_DOCUMENT_READING=off`; then each organization's administrator switches it on.
Migrations: platform 0013, tenant 0025 (and 0024's new column).
