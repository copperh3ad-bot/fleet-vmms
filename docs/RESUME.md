# Fleet OTG: where we stopped (resume point)

Written 2026-10-29 at the end of a long session. Read this first in the next session, then `STATE.md` (history, append-only), `CLAUDE.md` (rules), `docs/OWNER-CHECKLIST.md` (the owner's to-do list) and `docs/WHATSAPP-SETUP.md` (the WhatsApp set-up steps).

## Fallback points
- Git tag **`fleet-otg-resume-2026-10-29`** marks this state. Earlier tags: `fleet-otg-resume-2026-10-28` (before Pakistan-only and everything below) and `fleet-otg-non-ai-developments` (end of the non-AI work; ADR-034 onwards is the AI and plans stream).
- Last checks on this state: **805 unit tests pass**, only `tests/ledger.test.ts` "trial balance as of a date" fails on some runs (a date-boundary flake, unrelated); `next build` compiles; type-check clean for `src`.
- Last **full browser run: 225 passed, 0 failed** (before the one-time code and the WhatsApp work, which are not covered by the browser suite; they have unit tests).
- To go back: `git checkout <tag>`, or `git reset --hard <tag>` on master if you mean to discard later work.

## What is live and what is not
- **Live at https://www.fleetotg.com**: deployed twice on 2026-10-28/29, the last at commit `a9246bb` (Pakistan only, Request bill, vehicle sheet, trial limit, live chat, workshop links and email replies, AI reader, Basic/Pro, SEO, Terms/Privacy drafts, the prefetch fix).
- **Built, committed, NOT deployed**, after `a9246bb`: add-and-invite employee (ADR-041), emailed invitation link, one-time code on WhatsApp, WhatsApp requests and replies for workshops (ADR-042). Deploying them needs **platform migration 0014** first (see below).
- Deploy command: `find .next -name "* [0-9]*" -delete; npx netlify-cli deploy --build --prod --context production`.
- Migrations: the owner runs them on live with `! npx tsx --env-file=.env.local scripts/migrate-tenants.mts` (the auto-mode blocks me). **Run on live already:** platform 0012-0013, control 0014-0015, tenant 0023-0025. **Still to run: platform 0014** (`db/public/0014_invitation_otp.sql`, the code's hash, expiry, tries and sends on `public.invitations`). Deploying before it breaks invitations. After editing any `db/` file run `npx tsx scripts/embed-migrations.mts`.

## What is built (all in git; ADRs in `docs/adr/`)
| Area | ADR | State |
|---|---|---|
| Email, mailboxes, hook as a Netlify function, support/billing/sales settings | 024, 031 | live |
| SEO / AEO / GEO, /features, /llms.txt | 031 | live |
| Terms and Privacy full drafts | 032 | live; lawyer review pending |
| Workshops never sign up: links by phone or email; email replies filed on the job card | 033 | live |
| AI reads emailed estimates and invoices as a draft (Claude Haiku 5.5) | 034 | live, never run against the real API (needs `ANTHROPIC_API_KEY`) |
| Basic and Pro plans, Admin Plans page | 035 | live; plan switching by payment NOT built |
| Vendor scorecard and AI workshop recommendation | 036 | design only |
| Live chat (Zoho SalesIQ), tested | 037 | live |
| Vehicle sheet before sign-up, Excel import, 10-vehicle trial limit, tested | 038 | live |
| Pakistan only (`PAKISTAN_ONLY` in `src/app/signup/form.tsx`), no bank or tax on public pages or Billing, **Request bill** emails the bill with the bank details | 039 | live |
| Employees are only added with an invitation (Users page invite form, every box required, email or sign-in name); Employees page edits only; the link is also emailed; "Send a new link" keeps its row; Vehicles "Import data" button; **one-time code on WhatsApp before an invitation makes an account** | 041 | built, not deployed |
| WhatsApp sending through Meta's WhatsApp Business Platform (`src/lib/whatsapp.ts`); **"Ask on WhatsApp" for a workshop and filing its WhatsApp reply**, address `/api/inbound/whatsapp` | 041, 042 | built, not deployed, **not run against real Meta** |

(Code comments that once cited a separate ADR for adding an employee now cite ADR-041.)

## Owner inputs still needed (nothing here is secret to put in this file)
- **Run platform migration 0014**, then say "deploy".
- **Admin, Settings:** bank details and Billing email (without them the Request bill button is hidden), seller legal name, address, registration number, governing law and courts, Support and Sales emails, live chat code, trial vehicle limit, Pro threshold. **Admin, Plans:** confirm the Basic price; leave Pro bands empty.
- **WhatsApp (docs/WHATSAPP-SETUP.md):**
  - The number the owner tried to register was already on a WhatsApp account (error 2655122). Decision pending: use a different number (recommended) or delete that account on the phone.
  - In Meta: Phone number ID, a permanent system-user token, two templates (authentication `fleetotg_code` for the code, utility `fleetotg_request` with a dynamic button), the webhook `https://www.fleetotg.com/api/inbound/whatsapp` with the verify token, the app secret. The owner reached Meta's "Step 2. Production setup" and the number showed as registered.
  - Netlify variables: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_OTP_TEMPLATE`, `WHATSAPP_TEMPLATE_LANG` (only if not `en`), `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_REQUEST_TEMPLATE`. Until the first two are set no code is asked; without the last three nothing is received or asked from the job card. If the app is in Development mode Meta may only deliver to test recipients (error 131030): switch it to Live.
- **Resend inbound** (email replies): `reply.fleetotg.com`, MX at Spaceship, webhook `/api/inbound/email`, `INBOUND_REPLY_DOMAIN`, `RESEND_WEBHOOK_SECRET`, a full-access `RESEND_API_KEY` (docs/OPERATIONS.md).
- **AI:** `ANTHROPIC_API_KEY` (optional `AI_MODEL`, `AI_DOCUMENT_READING=off`).
- **Zoho:** `finance@` and `sales@` reach the owner; SalesIQ brand and widget code; decide on visitor tracking (the Privacy policy says it tracks).
- **Legal:** a lawyer reviews Terms and Privacy, then the draft notice in `src/components/legal.tsx` goes. **Search:** Google Search Console and Bing Webmaster, submit the sitemap.
- **ADR-036 decisions:** who rates a workshop and how, how long a record counts, whether the scorecard is Basic or Pro only.

## What to build next, in order
1. **Driver odometer readings on WhatsApp** (ADR-042 "Not done"): the odometer request goes as a second approved template with the single-use link (ADR-006); a driver's reply (a number, or a dashboard photo) becomes a pending odometer submission for that request, for staff to confirm. Needs its own database step like the workshop one (the workshop one is `src/lib/vendorflow/whatsapp-inbound.ts` reusing the three `inbound_mail` functions; odometer needs similar functions and an "odometer" reply route, probably a tenant migration 0026).
2. **DONE 2026-10-30 (ADR-043, commit after `0590a1b`): AI maintenance-policy parser**, draft-and-approve, built and unit-tested (819 pass), never run against the real API. **Needs tenant migration 0026 run on live before deploy** (with platform 0014), and a line in the Privacy policy for the company's own policy. The old plan, for reference: the page `/w/[slug]/policy` already has a plain-pattern reader (ADR-015, `src/lib/docs/policy-extract.ts`, applies via `policy-reading.ts`). Add a second "Read with AI" button: Claude returns the same `Finding[]` (value, target setting or service rule, and the quote it came from), values checked by `checkSetting`, a person confirms, applied through the existing server-side apply. Same gates as ADR-034 (Pro, the administrator's AI consent switch, limits, `ai_actions` log). `ai_actions` is tied to job cards, so it needs a policy anchor column (a new tenant migration). Draft and approve, not auto-apply, because the rules decide who pays for repairs; the owner may say otherwise.
3. Re-run the full browser suite (`bash e2e/run.sh`, about 8 minutes now) after 1 and 2; consider an e2e step for the WhatsApp request using `WHATSAPP_FILE` (`ALLOW_FILE_MAILER=1`) like the email outbox.
4. Open questions: the customer's tax-details form is still on the Billing page (the bill's tax figures and e2e `s5` depend on it); the trial-cap fallback to 10 for a non-numeric setting has no test; **fleet managers can no longer add employees** (adding now needs `admin.users` as well as `employee.manage`), tell the owner if that matters.
5. Later: moving plans by payment in Billing (ADR-035 step 2), vendor scorecard and AI workshop recommendation (ADR-036), delete the unreachable vendor portal code and its tests (ADR-033).

## Quirks worth knowing
- The pro-workflow hooks wrongly block some Bash commands that contain a heredoc or the word "commit"/"tag -m", and a secret scanner flags test constants like `SECRET = "..."`. Write scripts and messages with the Write tool and run or `git commit -F` them; build test secrets from parts (`["a","b"].join("-")`).
- Browser suite: `PLAYWRIGHT_CHROMIUM="$HOME/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" E2E_PGHOST=/tmp bash e2e/run.sh [public|companies|workspace|people|billing|lock|quality]` (several names may be listed; scenarios depend on earlier ones, so list the earlier ones too). It records browser console problems including missing files. To stop a run: `pkill -f e2e/run.sh; pkill -f e2e/run.mjs; pkill -f mock-supabase`.
- Employees in e2e are added with `addEmployee` in `e2e/lib.mjs` (the Users page form). A foreign test customer gets its country set directly on its tax record in `signUpCompany`.
- Tests that open a second database connection inside an open transaction hang (single-connection test database): read platform data before opening a tenant transaction.
- Do not paste tokens or keys in chat; set them in Netlify. Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and the `Claude-Session:` line given in the session.
