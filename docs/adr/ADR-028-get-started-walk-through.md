# ADR-028: A "Get started" walk-through for a new company

Status: accepted, 2026-10-25. Owner request: new companies should be walked through every step so their first data starts showing up on the dashboard.

## Decision
1. **The dashboard opens with a "Get started" list for a company that is still setting up.** Nine steps, in the order they build on each other: add vehicles, enter each vehicle's last service date, add drivers and staff, say who drives which vehicle, add a workshop, set a budget, add vehicle papers, invite the team, raise the first job card. Each step says what starts showing up once it is done ("Service due can only say what is overdue once it knows when each vehicle was last serviced"), and has one button to the page where it is done. The first unfinished step is lit and carries the main button.
2. **Done is read from the company's own data, never ticked by hand** (`src/lib/dashboard/onboarding.ts`). A step turns done the moment the data exists, from any route (the form, a CSV import, the offline job card form), and the list cannot go out of date. A step about vehicles is not done while there are no vehicles.
3. **Each person sees only the steps their role can act on.** A finance user sees "Set a budget"; a fleet manager does not see "Invite your team". A role that can do nothing but raise job cards (a driver) sees no walk-through at all, because company set-up is not theirs. Hiding steps is cosmetic: every page behind a button checks permission itself (CLAUDE.md rule 3).
4. **It leaves by itself when every step is done**, and a person can put it away with "Hide this for now" and bring it back with "Show the get-started steps". That choice is a cookie on that person's browser (per workspace), not company data: the settings table only accepts known keys, and a viewing preference does not justify a database migration. It means each person decides for themselves.
5. **No new tables, no migration, no new permission.** It reads tables that already exist.

## Not done
- No pop-up tour or locked screens: every other part of the app stays usable from the first minute.
- Steps cannot be skipped one at a time (a company that never uses budgets keeps one open step until it hides the list). Skipping per step would need stored data; add it if companies ask.
