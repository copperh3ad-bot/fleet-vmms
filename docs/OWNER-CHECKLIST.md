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
- [ ] **Terms and Privacy.** Full drafts are in place (ADR-032). In /admin/settings fill in **Seller: name on tax invoices**, **Legal: registered address**, **Legal: governing law and courts** (and the registration number if you have one) so the `[placeholders]` disappear. Then have a lawyer review both pages, confirm the commitments listed in ADR-032, and remove the draft notice in `src/components/legal.tsx`.
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

## V1.4 logistics providers (ADR-078): what is waiting for you (2026-11-09)
- [ ] **Say "apply and deploy"** for phase B2 and C: public 0018, control 0025, tenant 0046 (provider invoices) and 0047 (rate cards), then a deploy. Phase A, the quote link (public 0017, control 0024, tenant 0045) is already applied on live and its code is not yet deployed.
- [ ] **Two WhatsApp templates (utility category) for Meta approval**, only if you want Fleet OTG to send the requests itself. Until then staff send the links through their own WhatsApp or messages app and everything works.
  - Quote request, body: `{{1}}, {{2}} asks for your quote for trip {{3}}`, with a URL button `https://www.fleetotg.com/q/{{1}}`. Then set the secret `WHATSAPP_TRIP_QUOTE_TEMPLATE` to its name.
  - Invoice request, body: `{{1}}, the trip {{2}} for {{3}} is done. Please send your invoice`, same button. Then set `WHATSAPP_TRIP_INVOICE_TEMPLATE`.
- [ ] **Pro pricing**: Pro now includes outsourced trips (flag `outsourced_trips` on the Pro plan). Nothing is priced; enter the fleet-size bands on the Admin Plans page when you decide.
- [ ] **AI quote comparison (decision)**: the part of Pro that "manages the quotes with AI" is not built. It needs your decisions: (1) what may be sent to the AI provider (proposed: the quotes' amounts, validity, notes, vehicle text and the organization's reference rates, never names of people), (2) whether it uses the same administrator switch as the AI document reading (ADR-034) or its own, (3) whether it only suggests (proposed) or may also rank on the page. Say the word and I will plan it.
- [ ] **Provider login (decision)**: today a provider never signs in; it uses links. Say if a logistics provider should also be able to sign in and see its open requests.
- [ ] **Test it with real people**: add a logistics provider (Vendors, type Logistics provider) with a real mobile number, send a trip, and quote and invoice from a phone. Report anything awkward.
- [ ] **Enter your rate cards** (Vendors, a logistics provider, Rate card). They are your own reference figures; nothing is built in.

## V1.5 WhatsApp menu and cargo (ADR-079): what is waiting for you (2026-11-09)
- [ ] **Say "apply and deploy"** for: platform 0019, control 0026, tenant 0048 and 0049, then a deploy. All four phases of the menu (job card, cargo, trip, odometer) are built and tested, none is live.
- [ ] **Switch it on per company** (Vendors page, "WhatsApp menu", administrator, Pro plan). It is off by default.
- [ ] **Confirm one WhatsApp template for the fleet manager's notice**, so I can submit it to Meta (utility): `Hello {{1}}, a new {{2}} request {{3}} from {{4}} is waiting for you. Press the button to open it.` with a URL button `https://www.fleetotg.com/w/{{1}}` (the part after /w/ is filled in: the company, the page and the request). Then set the secret `WHATSAPP_CARGO_NOTICE_TEMPLATE` to its name. Without it, managers get the in-app notice only.
- [ ] **Mobile numbers**: each fleet manager and Logistics person needs a mobile number on their employee record to receive that WhatsApp notice, and every employee who will use the menu needs their own number on their record, with a login. A number shared by two employees is never guessed.
- [x] **Decision: the dashboard photo for odometer readings.** Decided 2026-11-09: odometer by text only.
- [x] **Decision: a tappable WhatsApp list.** Decided 2026-11-09 and built: the menu and the questions with options are lists, typing a number still works.
- [ ] **Test with real phones**: say Hi from an employee's phone, raise a job card with a photo, ask for cargo, reserve a trip and send a reading; then accept the cargo request as a manager and make a trip from it. Tell me anything awkward.
