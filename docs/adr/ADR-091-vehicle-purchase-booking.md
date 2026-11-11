# ADR-091: HR vehicle purchase booking

Status: accepted 2026-11-11 (owner decisions E1 to E5, docs/OWNER-DECISIONS-2026-11-11.md). Built, not deployed. Tenant migration 0058.

## Decision
When no pool vehicle fits an HR request, the request becomes a tracked purchase:

`requested` -> `budget_confirmed` (Finance enters the budget) -> `purchase_approved` (Fleet Manager or Administrator) -> `assigned` (the vehicle is added).

- **Finance confirms the budget first** (permission `vreq.confirm_budget`: Finance and the Administrator; Finance also reads all vehicle requests). A purchase cannot be
  approved without a confirmed budget. Finance may change the budget until approval. Nobody confirms a budget for their own request.
- **Fleet Manager or Administrator approves** (`vreq.decide`, unchanged). The approval screen shows the budget and the lowest dealer quotation.
- **Dealer quotations** (table `vehicle_request_quotes`: dealer, vehicle, price, valid until, note) are added by HR on its own request and by those who decide, give a vehicle or
  confirm budgets; the lowest shows first and one above the budget is marked. They can be added and removed only until the purchase is approved.
- **Adding the vehicle hands it over (E5):** the approved request shows "add it here", which opens Add a vehicle for that request. Saving closes the request and makes
  the employee the holder inside the same transaction, through the one transition function (`handOverPurchasedVehicle`, passed to `addVehicle` as `afterCreate`).
  If the hand-over is refused, the vehicle is not saved. It needs `vreq.assign` as well as `vehicle.write`. The holder fields on that form are ignored.
- A pool vehicle may still be given at any open step (`requested`, `budget_confirmed`, `purchase_approved`); the D1 warnings apply.
- `vehicle_request_transition` gained an amount argument (the old five-argument form is dropped). Segregation of duties is unchanged: no one decides a request for themselves.

## Consequences
Requests already in `purchase_approved` on live keep working: they have no budget on record, and are handed over when their vehicle is added. New purchases cannot skip the budget.
Not built: attaching the dealer's quotation files (the quotation figures are recorded, files can be added later); a purchase order; chasing the delivery date.
