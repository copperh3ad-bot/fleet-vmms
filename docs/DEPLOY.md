# Deploying the beta

The app builds to one self-contained server (`output: "standalone"`). The same build runs in a container, on a plain
Node 22 machine, or on any host that runs Docker images. Nothing here needs a hosting decision beyond "somewhere that
runs a container and keeps it up".

## What the server needs

| Name | When | Secret? |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | at **build** time (it is fixed into the pages) | no, public by design |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | at **build** time | no, public by design |
| `DATABASE_URL` | at **run** time | **yes**: keep it in the host's secret store, never in the image or the repo |

Use the pooled connection string for `DATABASE_URL` if the host runs more than one copy.

## Build and run

Container:

```
docker build -t fleet-vmms \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=... --build-arg NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=... .
docker run -p 3000:3000 -e DATABASE_URL=... fleet-vmms
```

Without Docker (Node 22):

```
npm ci && npm run build
cp -R .next/static .next/standalone/.next/static && cp -R public .next/standalone/public
PORT=3000 HOSTNAME=0.0.0.0 node .next/standalone/server.js
```

Health check: `GET /api/health` returns `{"ok":true}`. Put the site behind HTTPS (the host usually does this). The server
trusts `X-Forwarded-Host` and `X-Forwarded-Proto` to build the links people copy (invites, odometer links).

## Netlify

`netlify.toml` is set up for Netlify's own Next.js runtime (the standalone output is skipped there). One-time, from the
project folder:

```
npx netlify-cli login
npx netlify-cli link --id <the project id shown in Netlify>
```

Set the three variables from `.env.local` without printing them (`DATABASE_URL` as a secret):

```
set -a; . ./.env.local; set +a
npx netlify-cli env:set NEXT_PUBLIC_SUPABASE_URL "$NEXT_PUBLIC_SUPABASE_URL"
npx netlify-cli env:set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
npx netlify-cli env:set DATABASE_URL "$DATABASE_URL" --secret
```

Then build here and upload only the result: `npx netlify-cli deploy --build --prod`. Env changes need a new deploy.
There is no git remote yet, so deploys are by hand. If the repo goes to GitHub, connect it in Netlify and every push deploys.

Netlify limits to know: a request body over about 6 MB is refused by functions, so photo uploads above that fail even
though the app allows 10 MB; and each request may open its own database connection, so use the pooled
(transaction mode) connection string for `DATABASE_URL`.

## Before the first tester

1. **Supabase Auth settings** (dashboard, Authentication): set Site URL to the public address; allow the same address as
   a redirect; keep email confirmation on (invitations need a confirmed email); turn on leaked-password protection.
2. **Migrations** are already applied to the live project. After pulling new code, run
   `npx tsx --env-file=.env.local scripts/migrate-tenants.ts`. Migration 0015 (administrators can raise job cards) is
   still to be applied this way.
3. **Create the beta workspace**, with you as owner (see `docs/OPERATIONS.md`):
   `npx tsx --env-file=.env.local scripts/create-workspace.mts --name "Beta" --slug beta --owner-name ... --owner-email ... --plan small --base-url https://YOUR-SITE`
   Send the printed link to yourself first and go through sign-up.
4. **Real data or demo data?** Demo data (`scripts/seed-demo.mts --slug beta`) is for showing the system; testers working
   on their own fleet should start with an empty workspace and add or import their vehicles.
5. **Invite testers** on Users and roles. Vehicle users: role Requester (limited to the vehicle they hold). Managers:
   Fleet manager. Give each tester the address and tell them the invite link works once, for 7 days.
6. **Reminders**: `npm run reminders` has to run once a day from a scheduler on the host (cron, or the host's scheduled
   job feature). Without it no document-expiry notices are created.
7. **Backups**: switch on the database's daily backups and note how to restore before real data goes in.

## Known limits for a beta

- No sending channel: notifications appear in the app only. Invitation and odometer links are copied and sent by a person.
- The odometer link page shows only the plate and month and takes a number (no photo), by design (ADR-006).
- Plans have limits but no prices and no billing.
- Not yet seen in a browser by the developer: see the latest entries in `STATE.md`.
