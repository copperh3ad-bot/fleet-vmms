# Owner checklist: what only you can do

Saved 2026-10-25. Things that need the owner's hands, accounts, money or decision. Nothing here contains a secret: keys and passwords go into Netlify or Supabase settings, never into chat, the repository or this file. Tick items off by editing this file.

## Do first (security)
- [ ] **Rotate the database password.** It was printed once in a working session. Supabase, project `ajeouvrwnmfpiadndezt` (Tokyo): Project Settings, Database, reset password. Then update `DATABASE_URL` in Netlify (site `fleet-vmms-beta`) and redeploy.
- [ ] **Keep `SUPABASE_SERVICE_ROLE_KEY` only in Netlify** (done: added as a secret). Never paste it anywhere else.

## Before real customers
- [ ] **Choose a mail service** and set `SMTP_URL`, `EMAIL_FROM`, `AUTH_HOOK_SECRET` in Netlify, then turn on the Supabase "Send Email" hook. Order matters; steps are in `docs/OPERATIONS.md` (Email). Pick a paid sender (SES, Resend, Postmark): Supabase's own sender is limited to a few emails an hour.
- [ ] **Set SPF, DKIM and DMARC** for the sending domain, so sign-up and reset emails do not land in spam.
- [ ] **Supabase redirect URLs:** add `https://www.fleetotg.com/**` and `https://fleetotg.com/**`, and set the Site URL to `https://www.fleetotg.com`.
- [ ] **Fill the live settings** (operator Settings page): `bank_details` (you type these; they stay empty until you do), `seller_tax_reg`, `pkr_per_usd`, `support_email`, the tax authorities. Do not put a CNIC or a home address in any setting a customer can see.
- [ ] **Real Terms and Privacy text.** 15 placeholders are marked in the pages; they need your lawyer's wording.
- [ ] **Add an uptime monitor** for `https://www.fleetotg.com/api/health` (UptimeRobot or similar, free).

## WhatsApp / SMS invitation sending (the counter-corruption feature, to build later)
- [ ] Start **Meta Business verification** (the slow part: days). Needs your registered company details.
- [ ] Buy a **spare SIM** that has never been on WhatsApp, for the WhatsApp Business number.
- [ ] Get the **message template approved** (utility category).
- [ ] Optionally get a **local bulk-SMS provider** as a backup for people without WhatsApp (needs company papers and a sender name).
- [ ] Then give the access token and phone number ID as **Netlify secrets**, and ask for the feature to be built. Until then the flyer marks it "Coming soon".

## Decisions waiting for you
- [ ] **Administrator approving job cards:** today an administrator cannot approve; fleet managers do. Keep, or allow?
- [ ] **Tiered pricing by subscription length** (you decided to design it later; reference: Pakistan's minimum wage). Public pages say "about the same as a month's wage for an unskilled labourer" and hide the figure.
- [ ] **Billing inside the workspace still shows "$149 per month".** Keep, or hide to match the public pages?
- [ ] **"Tenant Admin" role name** reads as jargon. "Administrator" is clearer; it needs a database migration, so it is your call.
- [ ] **"Vendors" or "workshops":** one word everywhere. Which?
- [ ] **"Counter corruption" vs "built for accountability"** on the flyer and website, if customers' staff will read it.
- [ ] **Flyer contact details:** a phone/WhatsApp number or QR code to add (none is in the flyer yet). Check a print proof for colour.

## Checks only you can run (need your login)
- [ ] Open **Users** and the **dashboard** on https://www.fleetotg.com and confirm they load and look right.
- [ ] **Create a no-email invitation** (Users, Invite, "With a sign-in name"): pick an employee, enter a phone number, create it, and do not open the link yourself. Send me the exact message if anything errors.

## Waiting on a deploy
Say "deploy" to publish: the premium dashboard, the cleaned wording, the get-started walk-through and the wording fixes (commits `ec26c69`, `a241752`, `efd322e`, `a52253c`).

## Files in the project folder that are yours (left alone)
`Vehicle Policy._0001.pdf`, `fleet-vmms-design.zip`, `Pasted 2026-10-22 at 11.21.48 AM.textClipping`, and a stray `.next 2/` folder (an iCloud duplicate of a build folder; safe to delete).
