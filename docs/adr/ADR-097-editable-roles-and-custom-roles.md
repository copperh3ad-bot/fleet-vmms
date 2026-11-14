# ADR-097: The organization's administrator edits what each role may do, and makes roles of their own

Status: accepted, 2026-11-15. Owner request: "editable role permissions", with roles the administrator creates themselves.

## Context
Roles and what they may do were fixed by the product: the Users page showed a read-only table. Each organization already has its own `roles` and `role_permissions` tables (its own schema, ADR-014), `role_permissions` is already audited, and every check in the application (`can()`, the sidebar, the WhatsApp menu, notices) reads `role_permissions` live. So editing needs no change to how permissions are checked.

## Decisions
1. **Who:** only a person holding `admin.users` (the administrator), on the Users page, in their own organization. Every service function goes through `authorized(..., "admin.users")` (CLAUDE.md rule 3).
2. **What may be ticked** is the list in `src/lib/admin/permission-catalog.ts`: a plain sentence per permission, in groups. A permission that is not in the list and not in `LOCKED` fails `tests/custom-roles.test.ts`, so a permission added later is decided on purpose.
3. **Locked, never changed from the screen:** `admin.users` (stays with the administrator role, so an organization always has someone who can edit roles; a database trigger also refuses to delete it), the workshop's own `quotation.submit`, `workorder.update`, `invoice.submit`, and `gate.use` (that role has no screen yet). The workshop (vendor) role cannot be edited at all.
4. **Approving and verifying stay apart.** No role other than the administrator's may hold both an approving permission (`jobcard.approve`, `quotation.approve`) and `invoice.verify`. The administrator keeps both under ADR-077 and its rules for deciding one's own items. A copy of the administrator role leaves out `invoice.verify`.
5. **Roles of their own:** keys `custom_<8 hex>`, a unique name (case-insensitive), at most 20 per organization, made empty or starting from another role's permissions. They can be renamed and deleted; a built-in role can be edited but not renamed or deleted (also enforced by a trigger). A custom role cannot be deleted while a person holds it or an invitation names it. Custom roles appear in the invite, change-access and join-request lists because those read the `roles` table.
6. **Vehicle scope:** unchanged. A requester is always limited to their own vehicle; a custom role gets the scope chosen when the person is invited or changed.
7. **Audit:** `role_permissions` and `roles` already write to `audit_log` by trigger; nothing is added to the application. Saving is one change at a time per organization (a row lock on the tenant), like changing a member.
8. **Migration:** tenant migration 0066 adds `roles.is_builtin` (every existing role is built-in) and `created_at`, a unique lower-case name index, and the two guard triggers (execute revoked from public).

## Consequences
- A change applies the next time each person loads a page; there is no cache of permissions.
- A later migration that grants a new permission to a built-in role will still do so with `on conflict do nothing`; it does not undo a permission the administrator took away from an existing grant.
- Pro/Basic gating is unchanged: removing `cargo.request` from a role hides cargo for it; giving it to a role on Basic still shows nothing, because the plan check comes first.
