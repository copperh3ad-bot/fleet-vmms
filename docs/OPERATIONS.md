# Operations: what you run, and when

All commands run in the project folder in Terminal. They read the database connection from `.env.local`, which is never
committed. Put `--env-file=.env.local` after `tsx` as shown. Nothing here prints a password or key.

## Create a customer workspace (invite only)

```
npx tsx --env-file=.env.local scripts/create-workspace.mts \
  --name "Acme Transport" --slug acme --owner-name "Sara Khan" --owner-email sara@acme.example \
  --plan small --base-url https://YOUR-SITE
```

Prints one link. Send it to Sara. It works once, for 7 days. She creates her account with that email and becomes the
first administrator. From then on she invites everyone else on the Users screen. `--plan` and `--base-url` are optional.

## Set a plan's limits (no prices)

```
npx tsx --env-file=.env.local scripts/set-plan.mts --plan small --name Small --max-vehicles 25 --max-users 5 --tenant acme
```

Use `none` to remove a limit. Without `--tenant` it only defines the plan. A workspace with no plan has no limits.

## Add demo data to an empty workspace

```
npx tsx --env-file=.env.local scripts/seed-demo.mts --slug demo
```

Create the workspace first (above, with any owner email you control). It refuses a workspace that already has vehicles.
The sample people cannot sign in.

## Send document expiry reminders (once a day)

```
npm run reminders
```

Safe to run as often as you like: no reminder is sent twice. It needs to be scheduled by whatever hosts the site.

## Apply database changes after a new version

```
npx tsx --env-file=.env.local scripts/migrate-tenants.mts --check     # reports drift only, changes nothing
npx tsx --env-file=.env.local scripts/migrate-tenants.mts             # applies what is missing, everywhere
```

## Before you trust a release

```
npx vitest run          # all tests on the built-in test database
npx next build          # the site builds
```
