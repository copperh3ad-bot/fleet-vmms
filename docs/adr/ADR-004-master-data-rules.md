# ADR-004: Master data rules (custody, CSV import, form errors)

Status: accepted, Phase 2.

- **Custody changes are one SQL function.** `change_custody()` closes the current holder's row (the day before the new start) and opens the new one in one statement, so a vehicle never has two holders or a gap by accident. Past holders are never deleted; cost attribution (`custodian_on`) depends on that history. A new start on or before the current holder's start is refused rather than rewriting history.
- **CSV import is all or nothing.** The preview reports every row's errors; the import re-validates the same text inside one transaction and refuses if any row fails. A half-loaded fleet is harder to repair than a re-upload. Limits: 500 rows, 1 MB. No CSV library: the parser is 30 lines and tested.
- **The commit step imports the text that was checked**, not whatever is in the file box when the button is pressed.
- **New permissions** `employee.manage` and `vendor.manage` (admin, fleet manager). Employee contact details are not readable with `vehicle.write` alone; the custodian picker gets names only.
- **Plates are unique after removing case, spaces and hyphens** (already in 0004). The app uses the same rule (`plateKey`) so preview and database agree.
- **Visibility scope** `own` (membership `vehicle_scope`) limits vehicle list and record to vehicles currently held by the member's own employee record. Enforced in the query, tested.
- **Forms:** server actions return field errors and the typed values, because React 19 clears a form after every submit.
