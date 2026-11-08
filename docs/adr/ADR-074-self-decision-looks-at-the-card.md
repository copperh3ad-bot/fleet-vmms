# ADR-074: The administrator's "nobody else could" test looks at the card, not only the permission

Status: built; tenant migration 0040 to be applied on live **before** the deploy. Refines ADR-072. The same change sets the default phone format (decision 2).

## Context

ADR-072 lets the administrator decide their own job card or quotation only while no other active member holds the permission. A department role (logistics, ADR-048) holds `jobcard.approve` and `quotation.approve` but can decide only its own department's vehicles and only up to `dept_approval_limit`. Counting such a person as "someone else could" left cards that nobody could decide: the administrator was refused, and the department approver was refused by `dept_ok()` or the limit guard.

## Decision

1. `admin_may_decide_own(permission, vehicle, amount)` (tenant migration 0040) counts another active member only if they hold the permission **and** could decide this card: a role with no department always can; a department role only if the vehicle is in its department; and a department role only if the amount is within `dept_approval_limit` (empty limit = no limit). The one-argument form from 0038 stays, passes no scope, and behaves as before.
2. The job card guard and `approve_quotation` pass the card's vehicle and amount. The invoice check is unchanged (no department role holds `invoice.verify`).
3. The screens ask the same question per card: the job card page, and the dashboard (decided in SQL per row, so the administrator's own card is listed as waiting only when the database would accept their decision).
4. Phone numbers: the default format shown and suggested is `+92` then the number (`+92 300 1234567`), as placeholder, hint, error text and on-screen display. `0300 1234567` and other ways of typing are still accepted and stored as `+923001234567` (ADR-026).

## Not done

A `self_approved` flag on the job card. The record already shows who raised and approved the card and the event trail; a separate flag would add a column for no new fact. Revisit if reporting needs to filter on it.

## Order of going live

Apply tenant migration 0040 first (additive: the old code keeps working against it), then deploy. The new screens call the three-argument function and fall back to the one-argument form if it is missing, but the dashboard query needs 0040.
