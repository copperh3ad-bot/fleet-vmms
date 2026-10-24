# ADR-023: Crawler files and link previews

Status: accepted, 2026-10-24. From the full site audit (docs/SITE-AUDIT-2026-10-24.md, items 3 to 5).

## Decision
1. **Three static files are public:** `/robots.txt`, `/sitemap.xml` and `/.well-known/security.txt`. They hold no data about any customer. `PUBLIC_PATHS` names them exactly. Before, the sign-in guard redirected them, so crawlers and security researchers could not read them.
2. **What is listed.** The sitemap lists only the pages anyone can open and that say something (`INDEXABLE_PATHS` in `src/lib/site.ts`). Sign-in, reset and plumbing pages are left out. `robots.txt` asks crawlers to stay out of `/w/`, `/admin`, `/o/`, `/invite/`, `/setup`, `/auth/`, `/api/` and the reset pages. That is a request, not protection: every private address still needs a sign-in. A test checks every sitemap address is public and none is private.
3. **`security.txt`** points to the Contact page (there is no security mailbox yet) and carries an expiry date, which the owner renews once a year (docs/OPERATIONS.md). A test fails when it is within 30 days of expiring.
4. **Link previews.** Every page has a canonical link, and each public page has its own title and description in the preview tags (`pageMeta`). One share picture (1200 by 630, `src/app/opengraph-image.png`) and a phone home-screen icon (180 by 180, opaque, `src/app/apple-icon.png`, also copied to `public/apple-touch-icon.png` for phones that ask for it by name) are static files.
5. **The site address** is `https://www.fleetotg.com` in `src/lib/site.ts`, overridable with `NEXT_PUBLIC_SITE_URL`. It is a public address, not a secret.

## Not done
- No per-page share pictures, and no structured data.
- No security mailbox. When the owner has one, replace the Contact line in `security.txt`.
