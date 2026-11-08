# ADR-069: Files are reached through the server only

Status: built, not yet live. Amends ADR-025.

## Context

File storage ran with the signed-in person's own login token, and the bucket policies allowed that token to read, add and delete anything in the person's organization folder. The app checks the person's role before it touches a file, but the token also lives in the browser, so a workshop or driver account could call the storage API directly and skip those checks. The reach was one organization, never across organizations.

The WhatsApp webhook also saved photos with no signed-in person, so those saves had no storage rights at all.

## Decision

- Every file read, write, delete and signed link goes through four functions in `src/lib/supabase/admin.ts`, using the service key on the server. It is still the only file that names the key.
- `src/lib/supabase/blob-store.ts` is the only caller. Before each operation it works out the signed-in person's folders from the control plane (`user_orgs`, `tenants`) and refuses any other path. The operator may also read payment receipts (`<schema>/billing/...`) and nothing else, and may not write.
- Callers already read paths from rows they were allowed to see, so the role checks stay where they were (`authorized` / `authorizedAny`).
- The WhatsApp webhook saves media through the inbound saver, like the email webhook.
- Control migration 0020 drops the bucket policies for signed-in people and the two helper functions. With no policy, a login token reaches nothing in the bucket.

## Order of going live

Deploy the app first, check that files open and save, then apply control 0020. The previous app needs the policies.

## Consequences

- A stolen or abused login token no longer reaches files directly.
- The service key now also touches files, so `tests/auth-admin-key.test.ts` names the two files that may import it and fails if a browser-side storage client or an unguarded store operation appears.
