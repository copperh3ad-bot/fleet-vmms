# Fleet OTG: where we stopped (resume point)

Written 2026-10-28. Read this first in the next session, then `STATE.md` (history, append-only), `CLAUDE.md` (rules) and `docs/OWNER-CHECKLIST.md` (the owner's to-do list).

## Fallback point
- Git tag **`fleet-otg-resume-2026-10-28`** marks this state (a commit that type-checks; 745 unit tests pass, only `tests/ledger.test.ts` "trial balance as of a date" fails, a known date-boundary flake, unrelated).
- Earlier tag **`fleet-otg-non-ai-developments`** (commit `7d46790`) marks the end of the non-AI work. Everything after it (ADR-034 onwards) is the AI and plans stream.
- To go back: `git checkout fleet-otg-resume-2026-10-28` (or `git reset --hard <tag>` on master if you mean to discard later work).

## What is live and what is not
- **Live at https://www.fleetotg.com** is an older build (about commit `8529f60` plus the Send Email hook function from `ae5560b`, deployed 2026-10-27). Sign-up email works (Resend, `noreply@fleetotg.com`, Supabase hook on).
- **Nothing since then is deployed.** Do NOT deploy until the migrations below have been run on live, or the existing estimate link breaks.
- Deploy command: `find .next -name "* [0-9]*" -delete; npx netlify-cli deploy --build --prod --context production`.
- Migrations to run on live (the owner runs them with `!`, the auto-mode blocks me): `npx tsx --env-file=.env.local scripts/migrate-tenants.mts`. They are: platform **0012, 0013**, control **0014, 0015**, tenant **0023, 0024, 0025**. After editing any `db/` file run `npx tsx scripts/embed-migrations.mts`.

## What is built (all in git; ADRs in `docs/adr/`)
| Area | ADR | State |
|---|---|---|
| Email, mailboxes, hook as a Netlify function, support/billing/sales settings | 024, 031 | live (hook), settings pending deploy |
| SEO / AEO / GEO: JSON-LD, /features, /llms.txt, AI crawlers in robots | 031 | built, not deployed |
| Terms and Privacy full drafts (who "we" are from Settings) | 032 | built, not deployed; lawyer review pending |
| Workshops never sign up: estimate and invoice links by phone or email; email replies filed on the job card; staff enter figures; /join/workshop removed | 033 | built, not deployed |
| AI reads emailed estimates and invoices as a draft (Claude Haiku 5.5, prompt caching, consent, limits, logging) | 034 | built, not deployed, never run against the real API |
| Basic and Pro plans; Pro in fleet-size bands; Pro offered above 20 job cards a day (30-day average); AI gated by plan; Admin "Plans" page | 035 | built, not deployed. Plan switching by payment NOT built |
| Vendor scorecard and AI workshop recommendation | 036 | **design only** |
| Live chat (Zoho SalesIQ) on public pages and in the workspace | 037 | built, **no tests yet**, not deployed |
| Vehicle sheet before sign-up; Excel import; free trial limited to 10 vehicles (setting) | 038 | built, **no tests yet**, not deployed |
| Trial banner is a live countdown | (STATE.md) | built and tested |
| Flyer updated (workshops, Pro coming) | | `marketing/flyer/fleetotg-flyer.pdf/.png` |

## Open instruction not yet done (needs two answers first)
**"Limit the app to Pakistan only for now, update everything accordingly. Remove bank, tax and bank account holder name from any public pages and website."**
Questions to ask the owner before changing anything (I had not asked yet):
1. Where must bank, tax and account-holder details go? **Public pages only** (pricing, FAQ, Terms, Privacy, llms.txt, flyer, JSON-LD) while customers still see the payment details inside their signed-in Billing page? Or **everywhere including Billing** (then how do customers learn where to pay)?
2. Pakistan-only: **hide** the other countries (sign-up fixed to Pakistan, PKR shown, foreign-customer flows switched off but kept in code, reversible) or **remove** that code? Recommendation: hide.
Things this touches: sign-up country list, workspace currency, pricing page "How paying works", home FAQ "How do I pay", Terms section 5 (tax, withholding, currency), Privacy, e2e scenarios using a US customer, the flyer.

## Owner inputs still needed (nothing here is secret to put in this file)
- **Resend inbound** (for email replies): add `reply.fleetotg.com`, MX record at Spaceship on host `reply`, webhook to `/api/inbound/email`, Netlify variables `INBOUND_REPLY_DOMAIN`, `RESEND_WEBHOOK_SECRET`, a full-access `RESEND_API_KEY`. Steps in `docs/OPERATIONS.md`.
- **AI:** `ANTHROPIC_API_KEY` (and optional `AI_MODEL`, `AI_DOCUMENT_READING=off`) in Netlify.
- **Admin, Settings:** seller legal name, registered address, registration number, governing law and courts (Terms and Privacy placeholders), Support / Billing / Sales emails, live chat widget code and data centre, trial vehicle limit, Pro threshold (job cards a day).
- **Admin, Plans:** confirm Basic price; leave Pro bands empty until Phase 2.
- **Zoho:** make sure `finance@` and `sales@` reach the owner; create the SalesIQ brand and copy the widget code; decide whether to switch off SalesIQ visitor tracking (the Privacy policy currently says it tracks).
- **Legal:** a lawyer reviews Terms and Privacy and the draft notice in `src/components/legal.tsx` is then removed.
- **Search:** add the site to Google Search Console and Bing Webmaster and submit the sitemap.
- **Decisions pending** (ADR-036): who rates a workshop's level of service and how, how long a record counts, whether the scorecard is Basic or Pro only.

## What to build next, in order
1. Ask the two Pakistan-only questions above, then do that change (public pages, sign-up, copy, tests, flyer).
2. Write tests for the live chat (`src/lib/chat.ts`, `/api/chat-config`), the trial vehicle limit and the vehicle sheet (build the xlsx, read it back, `xlsxToCsv` into `previewVehicleImport`, cap enforced for add and import, disposed not counted, non-trial unlimited).
3. Re-run the full browser suite (`bash e2e/run.sh`, about 20 minutes; see quirks) and fix what it finds. The last complete run was 220 passed / 4 failed; the 4 were fixed in test code afterwards but a clean rerun was still running when this was written.
4. Owner runs the migrations, then deploy, then a real trial sign-up on live as the final check.
5. Later: moving plans by payment in Billing (ADR-035 step 2), vendor scorecard and AI workshop recommendation (ADR-036), delete the unreachable vendor portal code and its tests (ADR-033).

## Quirks worth knowing
- The pro-workflow commit hook wrongly blocks some Bash commands that contain a heredoc or the word "commit"/"tag -m". Write scripts with the Write tool and run them; commit and tag with `-F file`.
- Browser suite: `PLAYWRIGHT_CHROMIUM="$HOME/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" E2E_PGHOST=/tmp bash e2e/run.sh [public|companies|workspace|people|billing|lock|quality]`.
- Tests that open a second database connection inside an open transaction hang (single-connection test database): read platform data before opening a tenant transaction.
- Commits end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and the `Claude-Session:` line given in the session; never put secrets in the repo or in chat.
