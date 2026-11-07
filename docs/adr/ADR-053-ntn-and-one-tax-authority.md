# ADR-053: NTN for every invoice, one sales tax authority, no withholding

Status: accepted, 2026-11-07. Owner statement: "we don't have any withholding, sales tax not applicable, SRB is; NTN required for invoice generation." Simplifies ADR-017 and ADR-018 for the case the owner actually has.

## Decision
1. **NTN is required for an invoice.** Confirming a customer's payment, or recording one by hand, is refused with a plain message until the customer has entered its NTN. A customer abroad (country other than Pakistan) is not asked. The customer's own screen asks for the **registered company name and the NTN together** (and the address), and says why.
2. **The customer no longer chooses a tax authority.** The Billing page asks only for company name, NTN and address. The owner enters the one authority in force, **SRB (Sindh Revenue Board)**, in Admin, Tax with its rate, and its registration number under the seller settings; neither the rate nor the number is in the code. A customer who has chosen no authority falls under it when **exactly one** is active; with several active, nothing is guessed and no tax line is made. A customer whose own chosen authority was switched off stays untaxed.
3. **No withholding.** The customer's form no longer offers it, the save always records "not a withholding agent", and so no invoice shows income-tax or sales-tax withholding or an adjusted "send us" amount. The database fields, the operator's withholding settings and the certificate screens stay, unused, so this can be reversed.
4. **STRN and country are not asked** of the customer (Pakistan only, ADR-039); the country is kept from sign-up.
5. A plan priced in rupees (ADR-052) is taxed straight from the rupee price. Whether SRB tax is charged at all is still the owner's setting: with no authority rule or no seller registration, the invoice carries no tax line, as before.

## Owner steps
Admin, Tax: add the rule `SRB`, label "Sindh Revenue Board", the rate, active. Settings: the seller's SRB registration number (`seller_tax_reg`) and NTN (`seller_ntn`, already set). Admin, Plans: the rupee price. Customers that already exist must enter their NTN on the Billing page before their next payment can be confirmed.

## Tests
`tests/ntn-required.test.ts`; the billing and tax tests give each test organization a name and NTN; the one test that expected an unchosen authority to mean no tax now sets up two authorities.
