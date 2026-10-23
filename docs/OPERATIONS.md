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

## Running the SaaS (ADR-014)

### What the server needs, in addition to the three in DEPLOY.md

Nothing more is needed for the default (shared) mode: sign-up works with the three variables in DEPLOY.md. The table below is only for the optional dedicated-database mode (`ORG_DB_MODE=dedicated`).

| Name | What it is | Secret? |
|---|---|---|
| `ORG_DB_PROVIDER` | `neon` in production (`local` for development) | no |
| `NEON_API_KEY` | Neon API key; creates and removes each organization's database | **yes** |
| `NEON_REGION` | where new databases live, for example `aws-ap-southeast-1` | no |
| `ORG_DB_KEY` | 32 random bytes, base64: encrypts each organization's stored connection string | **yes** |

Without `NEON_API_KEY` the sign-up page says sign-up is not open yet. If `ORG_DB_KEY` is lost, stored connection strings cannot be read; they can be fetched again from Neon, so keep a copy somewhere safe.

### Becoming the operator

`npx tsx --env-file=.env.local scripts/make-operator.mts --email you@example.com` (the person must have signed up and confirmed their email). Then open `/admin`. Remove with `--remove`.

### First-time setup of billing (on `/admin/settings`)

1. **Bank account for payments**: shown to customers on their billing page.
2. **Seller details on invoices**: your company name, address, tax number.
3. **PKR per USD** (optional): shows the rupee amount next to the dollar price.
4. **Support email** and **payment instructions**.

### Every day

- The scheduled function sends document reminders and billing notices. Nothing else needs doing.
- `/admin/payments`: check each claim against the bank statement, view the receipt, then confirm or reject. Confirming issues the invoice and extends the paid period by the months credited.

### When something is wrong

- **A sign-up is stuck**: `/admin` shows its set-up state and last error (never a connection string). The customer's progress page retries the failed step; if it never recovers, delete the empty database from the organization's page and ask them to try again.
- **Update every database after a change in `db/`**: run `npm run embed:migrations`, commit, deploy, then `npx tsx --env-file=.env.local scripts/migrate-tenants.mts` (`--check` first to see drift). It visits the control database and every organization's own database, one at a time; one failing does not stop the others.
- **Check the sign-in path against live data without changing anything**: `npx tsx --env-file=.env.local scripts/check-routing.mts`.
