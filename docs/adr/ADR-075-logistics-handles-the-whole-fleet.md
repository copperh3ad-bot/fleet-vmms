# ADR-075: Logistics handles the complete fleet; a department role may still be limited to its own department

Status: built; tenant migration 0041 to be applied on live, after 0040 and before the deploy. Owner decision (2026-11-09). Amends ADR-048 decision 2 and refines ADR-074.

## Context

ADR-048 tied the `logistics` role to the department `Logistics` and made `dept_ok()` hide every vehicle outside it, including vehicles with no department. The live regression run saw a Logistics login with 0 vehicles and 0 job cards. The owner's intent is different: **Logistics is the fleet-management department and handles the complete fleet.** The tenant administrator only handles system settings, sign-in and onboarding. Administration is a separate department with its own vehicles and needs.

## Decision

1. `role_departments` gets `sees_all_vehicles` (tenant migration 0041). It is true for `logistics` and false for any department role added later (the way Administration would be added, ADR-048 decision 4: one role, one row).
2. A department role with `sees_all_vehicles` sees, raises job cards on, and maintains every vehicle, including those with no department and those of other departments. It stays **tied to its department** for the rest of ADR-048: the approval limit (`dept_approval_limit`), pool cars (which belong to the Logistics department), dispatch, and its place in rule B.
3. A department role with `sees_all_vehicles = false` is limited to its own department's vehicles exactly as before (`tests/dept-scope.test.ts` runs in this mode).
4. In SQL: `acting_dept_scoped()` is true only for the second kind. `dept_ok`, `dept_write_guard` and `dept_vehicle_guard` use it. `acting_department()` and `dept_over_limit()` are unchanged, so limits still apply to Logistics.
5. Rule B (ADR-074): another approver counts for a vehicle when their role sees the whole fleet or the vehicle is in their department. Logistics therefore counts for every vehicle, so the tenant administrator cannot decide their own card while an active Logistics approver exists.
6. Screens: "<department> vehicles only" and the empty-page note (ADR-074) apply only to a limited department role. A whole-fleet Logistics login shows "All vehicles", and the vehicle list offers the department filter, since it now sees several groups.
7. The switch is data. The owner (or the operator) changes `sees_all_vehicles` on a role's row; no code change is needed to add or limit a department role.

## Not decided

Who approves Administration's cards, and the role itself for Administration. Neither is built; the pattern in point 1 is ready for it.

## Decided by the owner (2026-11-09)

The tenant administrator's own job card is approved by a Fleet manager or a Logistics person (the fleet manager in the Logistics department). The rule B exception (ADR-072, ADR-074) is **kept**: the administrator may decide their own card only while nobody else could, so a new company with no approver is not stuck. `tests/dept-whole-fleet.test.ts` covers both sides.

## Order of going live

Apply tenant migrations 0040 and 0041 (both additive), then deploy. Until 0041 is applied a Logistics login still sees only its own department; the Users page query needs 0041, so do not deploy first.
