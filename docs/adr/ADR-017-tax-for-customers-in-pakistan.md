# ADR-017: Tax on subscriptions for customers in Pakistan

Status: accepted, 2026-10-24. Owner choices: tax is added on top of USD 149 (rule 7 stays true); the invoice is in USD with the rupee amounts shown; payments from corporate customers are received into the account of a PSEB-registered individual.

## Not tax advice
This system applies numbers the owner enters. It has no tax rate of its own, and nothing here has been checked by a tax adviser. Before the first real invoice, an accountant must confirm each item under "To confirm", below.

## Decision
1. **No rate is built in.** Sales tax rates are rows the operator adds (`tax_rules`, one per authority, for example a province), and withholding defaults are platform settings. When the law changes, the operator changes a row. Invoices already issued never change: each keeps a snapshot of the exchange rate, the percentages and the seller and customer details it was made with (`invoices.tax_snapshot`).
2. **Tax applies only when everything is in place:** the customer pays in dollars; the seller's sales tax registration number is set; a PKR-per-USD rate is set; the customer has chosen an active authority and given its registered name and NTN. Otherwise the invoice is made without tax, exactly as before.
3. **The arithmetic (`src/lib/billing/tax.ts`, pure and tested).** Subtotal = price in USD × rupees per dollar. Sales tax = subtotal × the authority's rate. Total = subtotal + sales tax. All in whole paisa, rounded half up, so every figure on an invoice adds up exactly.
4. **Withholding.** A customer that is a withholding agent keeps back income tax (a percent of the subtotal, or of the total if the accountant says so) and a share of the sales tax, pays that to the government in the seller's name, and gives a certificate. The invoice shows the total, what was withheld, and what should arrive in the bank. Percentages come from the platform defaults and can be overridden for one customer on its organization page.
5. **Before paying.** The customer's Billing page shows the amount to send for one month, with the same arithmetic the invoice will use. The operator's payments screen shows the invoice a confirmation would make, and whether what the customer says it sent is exact, short or over (a rupee of difference is treated as exact).
6. **Certificates.** Each invoice with a withheld amount stays on the operator's Tax page until its certificate number and date are recorded. Without the certificate the seller cannot claim the credit, so this is tracked as money owed, not as a note.
7. **The seller.** The invoice carries the seller's registered name, NTN, sales tax registration and PSEB number from settings. The bank account that receives the money should be in the same name as the seller on the invoice.
8. **The customer enters its own tax details** (authority, registered name, NTN, STRN, address, whether it withholds). It does not enter what it withholds; that is agreed with the operator and set by the operator.

## To confirm with a tax adviser before invoicing
- Whether an individual registered with PSEB must register for and charge sales tax on services to domestic customers, with which authority (federal, provincial), and at what rate for software or subscription services.
- Which authority a customer falls under: where the customer is, where the service is provided, or where the seller is registered.
- The income tax a withholding customer must keep back from an individual, and whether it differs for filers and non-filers. Whether it is worked out before or after sales tax (setting `wht_income_base`).
- How much of the sales tax a withholding customer keeps back, and whether the seller must file something for it.
- Whether the invoice must carry other fields or be reported electronically.
- Whether a USD invoice with rupee amounts satisfies the customer's accounts team, or the invoice should be in rupees.
- Whether receiving business income from several companies in an individual's account is acceptable in the owner's circumstances, or a registered business should issue the invoices. This system works either way: only the seller details change.

## Consequences
- Correcting a wrong invoice needs a credit note. This system has no credit notes yet: an invoice cannot be edited or deleted. Test with the real numbers on a customer you control before sending the first real invoice.
- The exchange rate on an invoice is the rate in Settings on the day the payment is confirmed, not the day the customer paid. If the rate changes in between, the invoice and the amount sent can differ slightly, and the operator sees this before confirming.
- A customer that does not fill in its tax details is invoiced without tax. The operator should not confirm payments from a Pakistani company before it has.
