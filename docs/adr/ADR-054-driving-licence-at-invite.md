# ADR-054: A driving licence is compulsory for every person invited

Status: accepted, 2026-11-07. Owner request: "compulsory driving license for each user at invite". Builds on ADR-041 (adding an employee and inviting them are one step) and ADR-044 (driving licences and their expiry reminders).

## Decision
1. The invite form on the Users page asks for the **driving licence number** and its **expiry date** for everyone invited as an employee, and, optionally, the licence class. Without a number and an expiry the person is not added and no invitation is made; each missing box is named.
2. The licence is saved in **the same database step** as the employee record and the invitation. If the invitation fails (plan limit, an open invitation for the email), the employee record and the licence go with it.
3. A licence that has **already expired** is refused, with its own message. A date that is not a date is refused.
4. The licence goes into the existing `driver_licences` table, so ADR-044 applies unchanged: the number is personal data, read in full only by people who manage employees or compliance, shown masked on lists, and never kept whole in the audit trail; expiry reminders already run for it.
5. **Not covered:** a workshop (the Workshop role is added on the Vendors page and is not an employee), a person who asks to join with the company code and is approved (the approval form does not ask for a licence yet), and people already in the system, whose licences are added on the Employees page as before. Ask if any of these should be compulsory too.

## Tests
`tests/add-employee.test.ts` (saved with the employee, required and named, expired refused); the browser helpers that add an employee fill the licence boxes.
