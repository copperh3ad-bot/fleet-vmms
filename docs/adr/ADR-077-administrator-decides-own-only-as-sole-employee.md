# ADR-077: The administrator decides their own work only when they are the only employee

Status: built; tenant migration 0042 to be applied on live (no code depends on it: it only tightens the database function). Owner decision (2026-11-09). Supersedes ADR-072's test ("nobody else could decide it") and ADR-074's per-card scope test.

> Scope note (2026-11-11): this ADR is about the administrator deciding **their own** work. What the administrator may do with **other people's** items is stricter and is set by ADR-088: while a fleet manager, Logistics or another approver is active, the administrator does not decide them unless the company switches `admin_decides_others` on. "Sole employee" here is not the rule for other people's items.

## Context

The tenant administrator handles system settings, sign-in and onboarding; a Fleet manager (or a Logistics person, who sees the whole fleet, ADR-075) approves job cards and quotations, and finance checks invoices. ADR-072 let the administrator decide their own work while no other active member held the permission, and ADR-074 refined "could decide" to the card's vehicle and amount. Both let the administrator through in a company that has other employees but no approver.

## Decision

The administrator may decide their own job card, quotation or invoice check **only while they are the only active employee** of the organization. Otherwise the Fleet manager (or Logistics) decides.

- `admin_may_decide_own(permission[, vehicle, amount])` (tenant migration 0042) is true only for the `tenant_admin` role and only when no other active member with a role other than `vendor` exists. The vehicle and amount arguments stay in the signature but no longer matter.
- A workshop (`vendor`) is not an employee. An invited person who has not joined is not yet a member. A disabled member does not count.
- It is evaluated at the moment of the decision, as before. Adding a Fleet manager, or any employee, ends the exception at once; disabling them all brings it back.
- The screens already ask the same function (job card page, dashboard, invoice review), so they follow without a change; the FAQ and About wording now says "only employee".
- Consequence the owner accepted: a company that has employees but no Fleet manager cannot move its first job until one is added. The decision panel says the card needs someone else.

## Departments

Administration is a separate department with its own vehicles; its job cards are approved by the Fleet manager (or Logistics), and it needs no approver role of its own for now. A role for Administration, if wanted later, is one more `role_departments` row with `sees_all_vehicles` off (ADR-075).

## Order of going live

Apply tenant migration 0042 on live whenever convenient; before it, live behaves as ADR-074. Nothing in the code needs it first.
