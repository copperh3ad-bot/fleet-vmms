# ADR-056: WhatsApp templates for workshop estimates, quotations and invoices

Status: accepted, 2026-11-07. Owner request. Extends ADR-042 (the request sent to a workshop's WhatsApp, and its reply).

## Before
One generic template, `fleetotg_request`, asked a workshop for an estimate or an invoice (and Meta classified it as Marketing). The workshop was told nothing afterwards: whether its estimate was approved or declined, whether its invoice was accepted or queried.

## Decision
Six Utility templates, English, submitted to Meta on 2026-11-07 (all pending review at the time of writing):

| Template | Sent when | Variables | Button |
|---|---|---|---|
| `fleetotg_estimate_request` | the app asks for an estimate | workshop, company, plate, job card | "Send estimate" to `/q/<token>` |
| `fleetotg_invoice_request` | the app asks for an invoice | workshop, job card, company | "Send invoice" to `/q/<token>` |
| `fleetotg_estimate_approved` | the estimate is approved | workshop, company, job card | none |
| `fleetotg_estimate_declined` | the estimate is rejected | workshop, company, job card, reason | none |
| `fleetotg_invoice_accepted` | the invoice is checked and accepted for payment | workshop, company, job card | none |
| `fleetotg_invoice_queried` | the invoice is returned with a question | workshop, company, job card, the question | none |

Each is switched on by its own Netlify setting naming the template: `WHATSAPP_ESTIMATE_REQUEST_TEMPLATE`, `WHATSAPP_INVOICE_REQUEST_TEMPLATE`, `WHATSAPP_ESTIMATE_APPROVED_TEMPLATE`, `WHATSAPP_ESTIMATE_DECLINED_TEMPLATE`, `WHATSAPP_INVOICE_ACCEPTED_TEMPLATE`, `WHATSAPP_INVOICE_QUERIED_TEMPLATE`. A setting that is not set means that message is not sent. For the two requests, the generic `WHATSAPP_REQUEST_TEMPLATE` (set to `fleetotg_request` on live on 2026-11-07) is used when the specific one is not set.

## Rules
1. Only the workshop's own mobile number from the Vendors record; a workshop with none is simply not messaged and nothing breaks.
2. **Best effort.** The decision is made first. A message that cannot be sent is logged without any number or text and never undoes the decision.
3. Template variables are one line, never empty, 160 letters at most (the reason or question typed by staff is cleaned to that).
4. No promotion, no link in the decision messages (the workshop's one-time links only ever come in the request), no amounts.

## Owner steps
Wait for Meta to approve the six (Meta may reclassify any as Marketing); then set the six settings in Netlify and redeploy. Until then the workshop flow works as before.

## Tests
`tests/workshop-whatsapp.test.ts`: variable order and cleaning, only the set template is used, nothing sent when unset or no number, a failure is reported not thrown.
