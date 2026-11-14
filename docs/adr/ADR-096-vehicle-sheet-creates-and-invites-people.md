# ADR-096: The vehicle sheet creates and invites the people who hold the vehicles; a valid licence is needed to join

Status: accepted, 2026-11-14. Owner request: a company signing up should be able to load its first vehicles and employees from one sheet, with the employees invited automatically; people may be invited without a licence on the sheet but cannot join without a valid one, and the system logs it. Builds on ADR-038 (the vehicle sheet), ADR-041 (employee and invitation in one step) and ADR-054 (a driving licence for everyone invited), whose rule moves from "at invitation" to "at joining" for people who come from the sheet.

## Decisions
1. The sheet gains six optional columns: `employee_name`, `employee_phone`, `employee_email`, `licence_no`, `licence_class`, `licence_expires_on`. `employee_no` keeps its meaning: an existing employee's code links the vehicle to them as before. A code nobody has, with a name and a phone, makes a new employee who holds the vehicle. The same code on several rows is one person.
2. A new person needs `employee_no`, `employee_name` and `employee_phone`. The email is optional. The check refuses a phone another organization has (ADR-082), an email or phone that another employee or another row already has, a bad code, and an expired licence. Licence number and expiry are both given or both left out.
3. Employees, their licences (when given) and the vehicles are saved together, all or nothing, like the vehicles were. People are made with the `employee.manage` permission; a fleet manager can import and add people.
4. **Inviting is a tick box on the check screen**, ticked by default, and only for someone with `admin.users` (the administrator). Invitations are made inside the same transaction, so a plan limit undoes the whole import. People are invited as **Requester limited to their own vehicle**. Those with an email are invited by email and WhatsApp the same way the Users page does (`src/lib/admin/deliver-invite.ts`, moved out of the page's actions); a person without an email is added but not invited. If neither email nor WhatsApp could deliver, the link is shown once for the administrator to send.
5. **A valid driving licence is needed to join.** When a person accepts an invitation and has no unexpired licence on their employee record, the join page (and the Accept button on the home page) asks for the number, expiry and optional class. Without a valid one the joining is refused and nothing is saved (no membership, no login for the sign-in-name path). What is typed is saved on the employee record, so it is in the audit log and in the licence expiry reminders. This applies to every invitation to an employee role, not only those from the sheet; invitations from the Users page already carry a licence and are unaffected. Workshops and password resets are exempt.
6. The activity log records the import action (who, outcome, time); the employee, licence, invitation and vehicle rows are in the audit log through their existing triggers.

## What it does not do
- It never invites without the tick box, and never sends anything at the check step.
- A person with no email gets no invitation from the sheet; the administrator invites them from Users with a sign-in name.
- Roles other than Requester are not set from the sheet; change a person's role on the Users page.

## Tests
`tests/import-people.test.ts` (checking, importing, all-or-nothing, who may invite, the licence rule at joining). Older invitation tests join through `tests/licence-mock.ts`, which types a licence, because they are about invitations rather than licences.
