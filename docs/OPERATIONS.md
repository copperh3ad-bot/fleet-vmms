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

## Email (sent by the app, ADR-024)
The app sends sign-up confirmation and password-reset emails itself, from your own address, through a mail service you choose. Do the steps in
this order. Do not switch the hook on (step 5) before steps 1 to 4, or every sign-up fails.
1. **Pick a service and verify your domain** **(you)**. Size it by vehicle users, not vehicles: everyone who raises job cards has an account, and each
   one gets a confirmation email when they join (by invitation or company code), plus reset emails later. A customer with 100 vehicle users sends 100 or
   more emails in its first days, and several customers can onboard in the same week. So choose a plan with **no daily cap**:
   - Amazon SES: about $0.10 per 1,000 emails, no daily cap once AWS approves production use (ask in the AWS console; a new account starts in a test mode
     of about 200 emails a day, to your verified addresses only). Cheapest at scale, more setup.
   - Resend paid plan (about $20 a month for 50,000 emails): the easiest. Its free plan stops at 100 emails a day, so use it only for testing.
   - Postmark, Brevo or similar also work. A hosting mailbox (Namecheap) works but shared-hosting mail often lands in spam and has hourly limits.
   Add the DNS records it names (SPF, DKIM, and DMARC) at Spaceship, then wait for it to say the domain is verified.
2. **Get the SMTP details** from the service: a host, a port (465 or 587), a user and a password or key. Put them in one address:
   `smtps://USER:PASSWORD@HOST:465`. Special characters in the user or password must be percent-encoded.
3. **Set three settings in Netlify**, Site configuration, Environment variables **(you)**. Mark all three as secret.
   - `SMTP_URL`: the address from step 2.
   - `EMAIL_FROM`: `Fleet OTG <noreply@fleetotg.com>` (an address on the verified domain).
   - `AUTH_HOOK_SECRET`: made in step 4, so add it after that.
4. **Make the hook in Supabase** **(you)**: Authentication, Hooks, Send Email, choose HTTPS, address `https://www.fleetotg.com/api/auth/send-email`,
   press Generate secret and copy it (it looks like `v1,whsec_...`). Do not enable it yet. Put the secret in Netlify as `AUTH_HOOK_SECRET`, then redeploy.
5. **Test, then enable** **(you)**: in Supabase, Hooks, use Send test or turn the hook on, then sign up with an address you own. The email must arrive
   from your address with the Fleet OTG look, and the button must lead to the workspace set-up. Also try "Forgot your password?".
- **If sign-up starts failing** ("We could not create your account"): in Supabase, Authentication, Hooks, switch Send Email off. Supabase's own sender takes over at once.
  Then check the three Netlify settings and Netlify, Logs, Functions for `send-email`.
- **Rotating the mail password:** change it at the service, update `SMTP_URL` in Netlify, redeploy.
- **Rotating the hook secret:** generate a new one in Supabase, update `AUTH_HOOK_SECRET`, redeploy, in that order, within a few minutes.

## Invitation links (ADR-026)
Every invitation, and every password reset link, goes to the person's phone number and nowhere else. After you create one, press "Send on WhatsApp" or "Send as a text message": your own phone opens
with their number and the message ready. Check the number on your phone before you send. There is no copy or email option, and the link is not shown on the screen. Do not open a first-time link
yourself: whoever opens it first sets the password. A person with no phone number on their employee record cannot be sent a reset link until you add one under Employees.

## People with no email (sign-in names, ADR-025)
Drivers and others with no email address are invited with an employee code, a role and a sign-in name. Nothing is emailed: you give them the link (copy it, or WhatsApp it).
- **One-time set-up** **(you)**: in Supabase, Project settings, API, copy the **service_role** key. In Netlify, Site configuration, Environment variables, add
  `SUPABASE_SERVICE_ROLE_KEY` with that value, mark it secret, and redeploy. Never paste it in a chat, a ticket or the repository. It can create and delete any login. Until it is set,
  inviting by sign-in name is refused with a plain message; email invitations are unaffected.
- **Run the migrations** first (`scripts/migrate-tenants.mts`): they add the sign-in names table and the new invitation columns.
- **A forgotten password:** an administrator opens Users and roles, finds the person, and presses "Make a password reset link". The link works once and lasts 2 days. The person
  also needs the **recovery code** they chose when they first set up; you cannot see it and the link is no use without it. Hand over a first-time link in person and do not open it yourself.
- **Forgot the password and the recovery code:** press "Replace login" on that person. Their old sign-in stops working at once and their employee code is freed; then invite them again
  with the same employee code. It is recorded in the audit trail with your name.
- **Rotating the key:** in Supabase, create a new service key, update `SUPABASE_SERVICE_ROLE_KEY` in Netlify, redeploy, then remove the old key.

## Who can do what
- Owner (you): operator pages, billing, tax settings, deploys, all dashboards above.
- The assistant: code, tests, migrations scripts, read-only audits. It does not hold your Supabase, Netlify or Namecheap logins.

## Once a year
- `public/.well-known/security.txt` says when it expires (`Expires:`, October 2027). Change that date to a year ahead before then; a security.txt past its date is ignored by tools.

## Known gaps (as of 24 October 2026)
- Application email: the app now sends it itself (see "Email" above), but it only takes effect once you complete those steps. Until then Supabase's built-in sender is used, which is limited to a few emails an hour.
- No external uptime monitor. Add a free one (for example UptimeRobot) that checks `/api/health` every five minutes and emails you **(you)**.
- No content-script policy on pages yet (the other security headers are on). It needs a per-request nonce; do it as its own piece of work.
- Bank details, seller sales-tax registration, fallback exchange rate, support email and tax authorities are empty in live settings.

## Being found by search and answer engines (ADR-031)
The site publishes structured data, `/llms.txt`, a Features page and a `robots.txt` that names the AI search crawlers. You do these once, by hand:
1. **Google Search Console**: add `https://www.fleetotg.com` as a property, verify it (DNS record at Spaceship), then submit `https://www.fleetotg.com/sitemap.xml`.
2. **Bing Webmaster Tools**: import the site from Search Console, and submit the sitemap. Bing's index also feeds several AI assistants.
3. **Check the markup** with Google's Rich Results Test on the home and pricing pages, and fix anything it reports.
4. **Keep the words true.** The FAQ on the home page is `src/lib/faq.ts`; change it there and the page and the markup change together. Never put the price in it.
5. To keep a crawler out of AI training, move its name in `src/app/robots.ts` from the answer list to a `disallow: "/"` rule.

## Workshop email replies (ADR-033)
Workshops never sign up. An organization emails a workshop a one-time link; the email can also be answered by replying with the estimate or invoice attached. Replies are received by Resend and filed on the job card; staff then type the figures in. Nothing works by email reply until you do all of this once (the one-time links work without it):
1. **Resend: add a receiving domain.** Resend, Domains, add `reply.fleetotg.com` (a subdomain, so your root domain's Zoho mail is not touched). It shows an MX record for receiving.
2. **Spaceship DNS:** add that MX record on the host `reply`. Do not change the MX records on `@`.
3. **Resend: add a webhook.** Webhooks, Add, address `https://www.fleetotg.com/api/inbound/email`, event `email.received`. Copy its signing secret (it starts `whsec_`).
4. **Netlify variables** (secret ones as secrets, then redeploy):
   - `INBOUND_REPLY_DOMAIN` = `reply.fleetotg.com`
   - `RESEND_WEBHOOK_SECRET` = the signing secret from step 3
   - `RESEND_API_KEY` = a Resend API key with **full access** (a sending-only key cannot read received mail). Make a separate key for this, and never paste it in chat.
   - `SUPABASE_SERVICE_ROLE_KEY` must already be set (it is used to save the files the email brought).
5. **Test:** on a job card waiting for an estimate, press "Email the link" to a workshop whose email on the Vendors page is yours, reply from that address with a PDF attached, and check the job card shows "Received by email, needs entering" with the file among its files.
6. **If replies do not arrive:** Resend, Emails, Receiving shows what it got; Resend, Webhooks shows the delivery attempts; Netlify, Logs, Functions shows `inbound-email:` lines (they never contain an address or text).
Until steps 1 to 4 are done, the emails the app sends simply leave out the "or reply to this email" sentence.

## AI reading of workshop documents (ADR-034)
When a workshop replies by email with an estimate or invoice, staff can press "Read the attached file with AI" and the form is filled in as a draft for them to check and save. It is off everywhere until you set it up and an organization's administrator switches it on.
1. **Netlify variables** (then redeploy): `ANTHROPIC_API_KEY` (secret; make a key just for this app in the Anthropic console and never paste it in chat). Optional: `AI_MODEL` (default `claude-haiku-5-5`, the cheapest that reads PDFs and photos; try `claude-sonnet-5-5` only if the "saved unchanged" share below is low), and `AI_DOCUMENT_READING=off` to switch the whole service's AI off at once.
2. **Run the migrations** platform 0013 and tenant 0024 and 0025 (`scripts/migrate-tenants.mts`).
3. **Each organization's administrator** opens Vendors and switches on "Reading workshop documents with AI". That records who and when. Nobody else sees the switch.
4. **Watch it work.** In Supabase, table `tenant_xxx.ai_actions` has one row per reading: model, tokens, cache use, and `outcome` (`saved_unchanged` means the AI got it right; `saved_edited` means a person corrected it; `pending` means it was never used). If `saved_unchanged` is well below about 80 per cent, try a larger model.
5. **Cost:** one reading is well under one US cent on the default model; 60 readings per organization per day is the cap. Anthropic's console shows the real spend. Prompt caching is on, so reading the same file again within five minutes costs very little.
6. **Privacy:** the Privacy policy already names Anthropic. Do not switch this on for an organization that has told you it does not allow its documents to leave the company.


## Basic and Pro (ADR-035)
Phase 1 sells Basic only. In Admin, **Plans** shows Basic's price (the current one) and Pro's fleet-size bands. Leave Pro's bands **empty** until Phase 2: the Pricing page then says Pro is coming, with no amount.
- **Phase 2:** fill in Pro's bands (up to N vehicles, price, AI readings per day; the last band has no upper limit), then Pro is for sale. It is offered as an upgrade to organizations that enter more than the number set in **Settings, "Pro is offered above this many job cards a day"** (20 if empty; measured as the average per day over the last 30 days). Moving an organization between plans by payment in Billing is the next change (ADR-035, step 2); until then you move one from its page in Admin.
- **Try Pro yourself:** on your own organization's page in Admin, "Waive billing (no charge)", then "Move to Pro". Then switch AI on in Vendors and set the Netlify AI variables (ADR-034).

## Live chat for customer support (ADR-037)
A chat button on the public pages and inside the workspace, using Zoho SalesIQ. Nothing shows until you set it up:
1. **Zoho SalesIQ:** sign in at salesiq.zoho.com with your Zoho account (admin@fleetotg.com), create a brand "Fleet OTG", and add your team as operators. Install the SalesIQ app on your phone to answer from it.
2. **Get the widget code:** SalesIQ, Settings, Brands, your brand, Installation. Copy **only the long code after `widgetcode`**. Note which Zoho address your account uses (salesiq.zoho.com for the US).
3. **Admin, Settings:** paste it into **Live chat: Zoho SalesIQ widget code**, and set **Live chat: Zoho data centre** if it is not salesiq.zoho.com. Save. The button appears within about five minutes (the answer is cached). Empty the code to switch the chat off.
4. **In SalesIQ, decide what visitors are tracked.** By default SalesIQ records the page and an IP-based location for every visitor, not only those who open the chat. The Privacy policy says so; if you would rather not, turn visitor tracking and IP location off in SalesIQ's brand settings and tell me so the policy can be changed.
5. The button never shows in Admin, on one-time workshop or driver links, or on the sign-in-code and password pages. Inside a workspace the team sees the company, workspace, plan and status, not the person's name or email. Leaving the workspace or signing out ends the chat session.

