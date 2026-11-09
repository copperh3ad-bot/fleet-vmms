# ADR-082: A phone number belongs to one organization at a time

Status: accepted, 2026-11-09 (owner decision: "One number can be in one organization at a time"). Supersedes the testing allowance for shared numbers across companies; the within-company testing mode of ADR-079 is unchanged.

## Why
WhatsApp tells us only the number a message came from. A number on the records of two companies cannot be told apart safely, and the menu had to ask "which company?" first.

## Decision
- A number is "in" an organization while an **active** employee record there holds it (last ten digits compared, so 0300 1234567 and +92 300 1234567 are one number). Marking that employee inactive releases it.
- A number held by another organization is refused when: an employee is saved (add or edit, unless the record is made inactive); an invitation is created with it (including add-employee-with-invite); and a person asks to join a company with it. The message names no company: "This phone number is already registered with another organization. A number can belong to one organization at a time."
- The check runs **after** the permission check, so a person without the permission learns nothing about other companies' numbers.
- People of the same company may still share a number (the menu asks who is writing, ADR-079).
- Demo workspaces (`seedDemo`) insert their made-up people directly; they carry the same fake numbers in every workspace and are not real numbers.

## Not done / watch
- This is an application check, not a database constraint: two administrators saving the same new number in two companies at the same instant could both succeed. A control-plane index of numbers would close that; not built because the risk at this size is small.
- Existing data is not changed. At the time of the decision, two numbers on live were in both test companies (Fleet OTG and Destinsolutions test records). They stay until the owner deactivates one side; editing such a record is refused until then.
- The "which company?" question in the WhatsApp menu stays in the code for any such leftover, and for an unusual race.
