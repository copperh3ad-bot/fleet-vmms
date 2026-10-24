# Full site audit, 24 October 2026

Scope: the live site (www.fleetotg.com), the live database and its Supabase advisors, the Netlify logs for the last 24 hours, the dependencies and the code. Everything was read-only. Nothing was changed on the live system.

## Needs action

| # | Finding | Where | What to do |
|---|---|---|---|
| 1 | **Contact form is broken live.** Control migration 0010 (`contact_messages`) is not applied: the live registry stops at 0009. A visitor who sends a message gets an error page, and `/admin/messages` fails. | Live database | Owner runs `npx tsx --env-file=.env.local scripts/migrate-tenants.mts`. |
| 2 | **Customers cannot be told where to pay or be invoiced with tax.** Empty in operator Settings: bank details, seller sales-tax registration, fallback exchange rate, support email, tax authorities switched on (0), stored exchange rate (none). | Live settings | Owner enters them. Bank details stay owner-entered. |
| 3 | **Search engines cannot read `robots.txt`, `sitemap.xml` or `security.txt`.** All three redirect to the sign-in page. | Site | Add them as public static routes (ADR needed for the public paths). |
| 4 | **Shared links show no preview.** No Open Graph or Twitter tags and no canonical link on any page, so a link sent over WhatsApp or LinkedIn shows a bare address. | Site | Add a share image and the tags. |
| 5 | **iPhone home-screen icon missing.** `/apple-touch-icon.png` returns 404 on every iPhone visit. | Site | Add an Apple icon. |
| 6 | **Terms and privacy are drafts** with 6 and 9 `[bracketed]` placeholders. | Site | Owner supplies the legal name and policies, then replace. |
| 7 | **No email authentication on the domain.** No SPF, DKIM or DMARC records, and the application email still goes through Supabase's limited built-in sender. Password-reset and confirmation emails depend on it. | DNS, Supabase | Set up SMTP from the company's own domain, then add the records it names. |
| 8 | **Supabase settings the owner must confirm** (not readable from here): redirect URLs include `https://www.fleetotg.com/**` and `https://fleetotg.com/**`; Site URL is set to the new address. | Supabase | Owner checks. |
| 9 | **An Administrator cannot approve job cards**, and approval needs a workshop, so a one-person company cannot finish a card. | Design | Owner decides. |
| 10 | **Database password appeared in a chat transcript** on 24 October. | Supabase, Netlify | Rotate it. |

## Worth doing, not urgent

- **Home page speed.** About 0.8 to 1.2 s to first byte against 0.3 to 0.8 s for the static pages, because it reads the plan from the database on every visit. Cache the plan for a few minutes.
- **Leaked-password protection is off** in Supabase Auth. It needs the Pro plan.
- **No uptime monitor** on `/api/health`. Backups could not be checked from here.
- **Patch updates available:** next 16.4.2 to 16.4.3, react and react-dom 19.3.0 to 19.3.1, eslint-config-next, pglite. Major versions (TypeScript 7, ESLint 10) are not recommended now.
- **Logo and other `public/` images** revalidate on every load (`max-age=0`). A longer cache would save a request per page.
- **One small accessibility note** on `/job-cards/new` when signed in: two landmarks share a name.

## Known and accepted

- Supabase security advisor, 33 INFO "RLS enabled, no policy": intended. The application is the only client; the public API roles hold no privileges (checked: migration 0009 is applied).
- Supabase security advisor, 92 WARN "function search path mutable" (90 tenant functions, 2 platform functions): the tenant functions run under the per-request `search_path` the data layer sets, so pinning one would break them. The live audit confirms no elevated-rights function has a changeable path and none can be called through the public API.
- Supabase performance advisor, 50 INFO unindexed foreign keys and 21 unused indexes: the database is small. Revisit when a company has thousands of job cards.
- One lint warning: the sign-in page navigates with `window.location.assign` on purpose (ADR note in the commit; the server redirect used the wrong host on `www`).

## Healthy

- **Certificate:** valid until 22 January 2027, issued by Let's Encrypt, renewed by Netlify. `http` redirects to `https`, and the bare domain redirects to `www`. DNS has exactly the intended records.
- **Security headers** on every page: HSTS, no framing, no content sniffing, referrer policy, permissions policy, a frame and form CSP. There is still no script policy (needs a nonce).
- **No server errors:** 0 responses of 5xx in the last 24 hours (2030 OK, 24 not found, 9 forbidden, the rest redirects and client disconnects).
- **Pages:** all 11 public pages answer 200 on desktop and phone, with one heading, title and description each, no console errors, no sideways scrolling, no broken internal links, and 0 accessibility violations.
- **Database audit:** every check passed: row security on every table, no public API privileges, every organization fully set up with billing and a findable member, the ledger balances in every currency, no invoice without its entry.
- **Dependencies:** `npm audit` shows 0 vulnerabilities, production and all.
- **Secrets:** none in tracked files; `.env.local` is ignored by git; only `.env.example` is tracked.
- **Tests:** 564 unit tests and the 137-step browser test pass; typecheck is clean.
- **Access control:** every private address sends a signed-out visitor to sign-in (checked on the live site, including the offline-form download and upload pages).
