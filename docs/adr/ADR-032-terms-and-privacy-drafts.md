# ADR-032: Terms of service and Privacy policy, balanced drafts

Status: accepted, 2026-10-28. Replaces the placeholder text from ADR-014. Not legal advice; the draft notice stays until a lawyer has reviewed the pages.

## Decision
1. **Full drafts** of the Terms (18 sections) and the Privacy policy (12 sections), written from what the service actually does: job cards, workshops
   and one-time links, billing by bank transfer, the lock-and-export model (ADR-014), tax rules (ADR-017, ADR-018), and the providers in use.
2. **Balanced.** For customers: their records belong to them, they can export at any time (also when locked), price changes need 30 days' notice,
   material changes to the terms need 30 days' notice, the owner commits to tell them of an exposure without undue delay, and the owner covers
   third-party intellectual-property claims. For the owner: the service is a management tool and not advice; workshop dealings are between the
   customer and the workshop; decisions about repairs, payments and safety stay with the customer; liability is capped at 12 months of fees with
   the usual exclusions; fees are not refunded part-way through a period; the customer answers for what it enters and for its users.
3. **Two roles in the Privacy policy.** The owner is responsible for sign-up, billing, support and security records. For an organization's fleet records
   the organization decides and the owner processes them on its behalf; people in those records are sent to their organization first.
4. **Who "we" are comes from Settings, not code.** The legal name is the existing "Seller: name on tax invoices"; new settings are the registered
   address, the registration number (optional) and the governing law and courts. Anything not entered shows as a `[bracketed]` placeholder, so the
   page cannot state something nobody decided and the launch check in the browser test keeps flagging it. The pages render per request for this reason.
5. **The providers named are the ones the code uses** (Supabase, Netlify, Resend, Zoho Mail). A test checks the list, that no card or tracking provider is
   in `package.json`, that no price is in either page, and that the 30-day keep-after-lock period agrees with the home page.
6. The version stamp recorded at sign-up moves to `2026-10-28-draft`.

## Owner must decide before launch (marked in docs/OWNER-CHECKLIST.md)
Enter the three settings; have a lawyer review both pages and remove the draft notice (`src/components/legal.tsx`); confirm the commitments the drafts make
for you: 30 days' notice of price or terms changes, 60 days' notice and a refund if the whole service ends, "without undue delay" breach notice, the 12-month
fee cap, and the Tokyo data location.
