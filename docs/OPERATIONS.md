# Running Fleet OTG: what to check, and what to do when something breaks

Written for the owner, not an engineer. Commands go in the terminal inside the project folder. Anything marked **(you)** is done in a
website with your own login; the assistant cannot reach those accounts.

## Every day (two minutes)
- Open `/api/health` on the live address. It must answer `{"ok":true}`.
- Netlify, then the site, then Functions: the `reminders` and `fx-rates` functions should show a run in the last 24 hours with no error.
- Operator pages: `/admin/payments` for claims waiting to be confirmed, `/admin/rates` for today's exchange rate.

## Every week
- `npx tsx --env-file=.env.local scripts/audit-system.mts` reads the live database and prints `ok` or `FAIL` per check. It changes nothing.
  Any `FAIL` line is worth a message to the assistant.
- Supabase, then Advisors (security and performance) **(you)**. New warnings after a change are worth reading.

## Before and after any change that touches the database
1. Check that a backup exists **(you)**: Supabase, Database, Backups. Know what your plan keeps: some plans keep only daily copies, or none.
   If you cannot see a recent backup, do not run a migration.
2. Run the tests: `npx vitest run`.
3. Migrate: `npx tsx --env-file=.env.local scripts/migrate-tenants.mts`. It is safe to run twice.
4. Deploy: `npx netlify-cli deploy --build --prod --context production`.
5. Open `/api/health` and sign in once as an operator.

## If the site is down or very slow
1. `/api/health`: if it answers, the app is up and the problem is one page or one company.
2. Netlify, then Deploys **(you)**: if the last deploy failed, the previous one is still live. If the last one succeeded but the site broke,
   open an earlier deploy and choose "Publish deploy" to roll back in one click.
3. Supabase, then Project status **(you)**: a paused or overloaded project makes every page fail.
4. Netlify, then Logs, then Functions **(you)**: errors show a short code that matches the "quote this code" line users see.

## If a customer cannot sign in
- Wrong password: they use "Forgot your password?" on the sign-in page (ADR-019). The link in the email works once, and only in the
  browser they asked from. It needs the address's `/**` entry in Supabase, Authentication, URL Configuration, and the Site URL **(you)**.
  If the email never comes, set a new password by hand in Supabase, Authentication, Users **(you)**.
- No confirmation or reset email: check spam; the free Supabase email service allows very few emails per hour. A company that cannot wait
  can be confirmed by hand in Supabase, Authentication, Users **(you)**.
- "No access" after sign-in: their company may be locked for non-payment (the page says so), or they have no role yet (their administrator
  assigns one under Users).

## Secrets: what to rotate and when
Rotate immediately if a value was pasted somewhere public, shown on a screen share, or a laptop was lost.
- **Database password** (Supabase, Database settings **(you)**): then update `DATABASE_URL` in Netlify and in `.env.local`, redeploy.
- **Supabase keys** (Supabase, API settings **(you)**): update the two `NEXT_PUBLIC_` values in Netlify, redeploy (they are fixed in at build time).
- **Secret box key** (encrypts dedicated-database addresses): do not rotate without the assistant; stored values must be re-encrypted first.
- Never put any of these in a message, a ticket or the repository.

## Who can do what
- Owner (you): operator pages, billing, tax settings, deploys, all dashboards above.
- The assistant: code, tests, migrations scripts, read-only audits. It does not hold your Supabase, Netlify or Namecheap logins.

## Once a year
- `public/.well-known/security.txt` says when it expires (`Expires:`, October 2027). Change that date to a year ahead before then; a security.txt past its date is ignored by tools.

## Known gaps (as of 24 October 2026)
- Application email comes from Supabase's built-in sender, which is limited. Set up SMTP from your own domain before real customers arrive.
- No external uptime monitor. Add a free one (for example UptimeRobot) that checks `/api/health` every five minutes and emails you **(you)**.
- No content-script policy on pages yet (the other security headers are on). It needs a per-request nonce; do it as its own piece of work.
- Bank details, seller sales-tax registration, fallback exchange rate, support email and tax authorities are empty in live settings.
