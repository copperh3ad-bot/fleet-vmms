# ADR-052: A plan priced in rupees, and drop-downs on the Add vehicle form

Status: accepted, 2026-11-07. Owner requests: "prices in PKR" and "add vehicle form dropdowns". Amends ADR-014 and ADR-018 (the plan was priced in dollars and converted at the interbank rate on the payment date) and CLAUDE.md rule 7 (which names USD 149).

## 1. A plan can be priced in rupees
- The price and its currency live in the `plans` table and are entered by the owner on **Admin, Plans** (Price and Currency boxes). Nothing about a price is in the code. Entering the price with currency `PKR` is all it takes; the amount is the owner's decision and was **not** set by this change.
- Customers who join afterwards get the plan as it is then; an organization keeps the price and currency it joined at (as before), so existing customers stay in dollars until the owner changes their record.
- **Tax on a rupee plan** (`taxFor`): the price is already in rupees, so there is no conversion: the sales tax, the withholding and the invoice total are worked out from the rupee price with a rate of 1, in the same arithmetic as a converted dollar price. The invoice and the bill show the price as rupees (not "$149 at Rs X to the dollar"), the stored rate is 1 and no exchange-rate row is needed. A dollar plan is untouched.
- Currencies other than USD and PKR are still not taxed this way.
- The Pro bands have their own Currency box and are priced the same way.
- **Owner steps:** to switch the live price, open Admin, Plans, enter the rupee amount (for example 41500) and set Currency to PKR. The pricing page, the sign-up page and the Billing page then show it as "Rs 41,500". CLAUDE.md rule 7 still names USD 149 and should be updated by the owner to match.

## 2. Make, model and year are drop-downs
- On Add vehicle, **Make** is a drop-down of makes common in Pakistan (cars, pickups, vans, trucks, buses, motorcycles and yard equipment, `src/lib/master/vehicle-catalog.ts`); **Model** is a drop-down of that make's models, and **Year** a drop-down from next year back to 1980.
- Each of make and model ends in **Other (type it)**, which opens a text box, and a make with no listed models (for example yard equipment) asks for the model as text. So a vehicle is never refused for not being on the list.
- The server turns the choice and any typed name into the one name that is saved. Vehicle class and fuel were already drop-downs. Sign-up's "How many vehicles?" was already a drop-down.
- Not changed: the import file and the Excel sheet still take free text (make and model), because a company brings its own spellings; the sheet's lists for class and fuel are unchanged.

## Tests
`tests/pkr-plan.test.ts` (tax on a rupee plan, withholding, an invoice in rupees with no dollar rate), `tests/vehicle-catalog.test.ts`, and the browser scenarios that add vehicles now pick from the drop-downs.
