# ADR-061: Raising a job card by WhatsApp (V1.1)

Status: **accepted as the V1.1 plan (Pro only), 2026-11-07; built the same day, not deployed** (platform migration 0016 and tenant migration 0035 not run on live). See "As built" below. Owner direction: "In V1.1 we enable job card submissions through WhatsApp." Chosen with the owner: registered employees only, identified by phone number; one free-form message read by the AI into a draft the sender confirms; the card then goes in as Requested and follows the normal approval. Builds on ADR-042 (inbound WhatsApp), ADR-034 and ADR-043 (the AI reader), ADR-035 (Basic and Pro) and ADR-050 (identifying a sender by phone).

## The flow
1. An employee sends the Fleet OTG WhatsApp number one message, for example: "LHR-1001 brake noise, front left, needs looking at today", with up to 3 photos in the same message or the next few minutes.
2. Fleet OTG finds who they are (below). If it cannot, it says so and files nothing.
3. The AI reads the text and photos into a **draft**: vehicle registration, a reason category (the existing ones), a short description, how urgent. The AI never creates anything.
4. Fleet OTG replies with the draft in plain words: "Job card for LHR-1001 (Toyota Hilux). Brake noise, front left. Reason: wear and tear. Reply YES to send it, or reply with a correction." The vehicle shown is the one found in the company's own records, matched by registration in the database, not by the AI.
5. **YES** creates the job card through the one existing function, `createJobCard`, with the sender's own role, so the same checks apply as in the app (`jobcard.create`, the vehicle must be one the person may use, the licence and department rules). It is created as **Requested** and marked as raised by WhatsApp. A correction re-reads the draft (max 3 rounds), anything else leaves it waiting, and it lapses after 30 minutes with no answer.
6. The sender is told the job card number. When a manager approves, rejects or closes it, the sender is told in the same chat **only if the person wrote in the last 24 hours** (Meta's free-form window). Outside that window nothing is sent in V1.1; the status stays in the app.

Approval, estimates, invoices and every state change stay in the app and in `transitionJobCard` (CLAUDE.md rule 4). WhatsApp only raises the request.

## As built (differences from the plan below)
- **No phone-hash index.** Finding the sender scans only the organizations that have switched this on (a flag on `public.tenants`, platform migration 0016: `wa_jobcards_enabled`, `wa_jobcards_by`, `wa_jobcards_at`) and matches the last ten digits of the number against active employees with a login in each. The control plane stores no phone numbers and nothing needs keeping in step. Revisit if many companies switch it on (a message costs one small query per enabled company).
- **The switch lives on the platform row, not in the company's settings**, beside the AI documents switch, and is on the Vendors page next to it. Switching on needs the Pro plan and the administrator.
- A number that matches nobody is not answered here at all: the older WhatsApp flows run as before.
- A number matching two employees in one company is never guessed: the message is left to the other flows.
- Several companies: the message starts with the company's name and a colon, or the person has a draft open in one.
- The AI call is `readJobCardMessage` in `src/lib/ai/claude.ts` (schema and checks in `jobcard-draft.ts`); the conversation is `src/lib/wa-jobcards/service.ts`; the webhook calls it after the odometer flow and before the workshop flow. A failure inside it is answered kindly and never retried.
- Tenant migration 0035: `whatsapp_intake` (also holds the model, tokens and the outcome of each read) and `job_cards.source`, shown as "Raised by WhatsApp".
- Limits as planned: 20 messages an hour and 10 drafts a day per sender, the plan's daily cap per company, 3 photos of at most 5 MB, images only.

## Who is the sender
- A new control-plane index `public.wa_phone_index (phone_hash, tenant_id)` maps a sender to the organizations where an active employee has that number. `phone_hash` is a keyed hash (HMAC-SHA256 of the normalized E.164 number with a server secret), so the control plane never stores numbers. It is kept in step with `employees.phone` by the same code that keeps `user_orgs` in step, and every query on it names the organization (CLAUDE.md rule 9).
- The number must match an **active employee linked to a login** with `jobcard.create`. If the number is in several organizations, the app asks which company (by name) and waits for the answer. A number in none is told "this number is not registered with a company" and the message is dropped; it is never stored.
- The tenant then does the real check: the employee's role, vehicle scope and licence rules, using the existing `can()` path. WhatsApp identity is the phone number only, which is weaker than a login; this is why the card enters as Requested and a manager still approves it, and why the sender sees a confirmation before anything is created.

## The AI
- One call per message to the existing Claude client (`src/lib/ai/claude.ts`), no tools, no memory. It gets the message text and the photos and nothing else about the company: no people, no other vehicles. Its answer is data, checked and trimmed by code (a registration-like string, a category from the fixed list, text of limited length). Anything it returns that does not check is treated as "could not understand" and the sender is asked to rewrite it.
- Text inside a message or photo is data, never instructions. A message cannot make it do anything but fill the draft.
- It reads English, Urdu and Roman Urdu. Replies go out in English in V1.1.
- Each use is recorded (`ai_actions`, with tokens and outcome: confirmed, corrected, lapsed), so cost and quality are measured.

## Stored data
- **Tenant migration (next free is 0035):** `whatsapp_intake` (id, employee_id, status collecting|waiting|confirmed|lapsed|cancelled, the checked draft as JSON, photo paths, rounds, expires_at, created_at); `job_cards.source` ('app' or 'whatsapp', default 'app'), shown on the card and in history. Photos go to the same attachments store as the web form. Intake rows are deleted 7 days after they close.
- **Platform migration:** `wa_phone_index`, above.
- **Settings:** a company setting `whatsapp_jobcards` (0 or 1, **off by default**), switched on by the administrator; its guard function is replaced in the same migration before the starting value is inserted. A company that has not switched it on gets "this is not switched on for your company".

## Limits and safety
- The webhook is the existing signed one (`/api/inbound/whatsapp`, CLAUDE.md rule 5); no new public address.
- Per sender: 20 messages an hour and 10 drafts a day; per company: a daily cap from the plan (as ADR-035 does for AI). Over the cap, the sender is told to use the app.
- At most 3 photos of at most 5 MB each (images only; PDFs are not read here). Voice notes, locations and stickers get a one-line "please type it" reply and are not stored.
- No number, message or photo is logged. Delivery failures are logged by code only, as ADR-042 does.
- A reply to a prompt the app sent must only ever be matched to its own pending intake row (by sender and open status), never by a guess.

## Plan gating (decided by the owner, 2026-11-07: Pro only)
This uses the AI, which ADR-035 makes the Pro feature. **It is a Pro feature**, and also switched on per company by its administrator (`whatsapp_jobcards`). A Basic company that tries it is told this is a Pro feature and is pointed to the app. The offer follows ADR-035: the same "offered to organizations that enter many job cards a day" rule and the same Pro plan, with no separate price. The per-company daily cap comes from the Pro plan.

## Meta
No new template is needed: the employee starts the conversation, and every reply is free-form inside the 24-hour window. The app's webhook already receives `messages`. (Out-of-window status updates would need a Utility template; deferred.)

## Not in V1.1
Voice notes, locations, several vehicles in one message, approving or commenting on a card from WhatsApp, out-of-window status updates, workshops and drivers without an employee record raising cards, Urdu replies.

## Tests to write with it
Identity (unknown number, several companies, inactive employee, no permission, switched off); draft checking (garbage from the AI, a registration not in the company, a vehicle the sender may not use); confirm, correct, lapse and cancel; the card is created Requested with `source = whatsapp` and an event; rate and daily caps; photos stored, other files refused; the AI call mocked, never the network; signature required; nothing logged. Browser suite scenario: the job card shows "raised by WhatsApp".

## Owner steps (after it is built)
Switch on `whatsapp_jobcards` for a company; set `ANTHROPIC_API_KEY` in Netlify if not set; set the phone-hash secret in Netlify; run the platform and tenant migrations; test with a Pakistani number (not Indonesia, code 130497).
