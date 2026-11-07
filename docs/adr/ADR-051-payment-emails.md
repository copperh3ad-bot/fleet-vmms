# ADR-051: Emails around a subscription payment

Status: accepted, 2026-11-07. Owner request: tell finance@ when a customer files a payment, and tell the customer the answer. Extends ADR-014 (bank transfer and claims) and ADR-039 (the emailed bill).

## Before
A customer pays by bank transfer and files "I have paid" with a receipt. The operator sees the claim only by opening the Payments screen, confirms or rejects it there, and the customer sees the result only by opening the Billing page. Nobody was emailed.

## Decision
1. **A claim is filed:** an email goes to the **Billing mailbox** (the `billing_email` setting, `finance@fleetotg.com` on live): the organization, the reference on the transfer, the amount, the date, the months, whether a receipt was uploaded (the receipt itself stays on the Payments screen, never attached), the customer's note, and who filed it. A link opens the Payments screen. Reply-to is the person who filed it.
2. **The operator confirms:** the person who filed the claim is emailed the invoice number, the amount received, the months credited and the date the subscription is paid up to, with a link to the Billing page. **Reply-to is the Billing mailbox**, which also gets a copy.
3. **The operator rejects:** the same person is emailed the reason the operator wrote, told that nothing has been charged or credited, and that they can file again. Reply-to is the Billing mailbox, which gets a copy.
4. **Where the customer's address comes from:** the signed-in person's own address from their session, saved with the claim (`payment_claims.submitter_email`, control migration 0017) and used only for the answer to that claim. A claim filed before this change has none; then only the Billing mailbox hears, and the copy's subject says the customer was not told.
5. **Never in these emails:** bank details (those leave the system only in the bill, ADR-039), the receipt, or any secret. What a customer typed is escaped in the HTML.
6. **Best effort:** a mail problem is logged (no address) and never undoes a claim or a decision. With no Billing mailbox set, nothing is sent to it. Not covered: payments the operator records by hand (cash, a call), which have no claim and no customer address.

## Tests
`tests/payment-mails.test.ts`: what each email says, escaping, the alert, no mailbox set, a failing mailer, confirm and reject with a copy to Billing, and a claim with no address.
