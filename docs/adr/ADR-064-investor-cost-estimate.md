# ADR-064: Investor flyer and the monthly cost estimate for a 200-vehicle company

Status: accepted, 2026-11-08. Owner request: a flyer for investors estimating the monthly cost per organization of 200 vehicles, with the application's features and use cases. The flyer is `marketing/investor-flyer/` (HTML, two A4 pages, PDF and one PNG per page).

## What the numbers are
Planning estimates in US dollars a month, from the usage assumptions printed on the flyer (200 vehicles, about 50 people, about 200 job cards, about 400 AI-read documents, about 200 monthly odometer requests on WhatsApp, Pro plan). They come from the price lists as understood on 2026-11-08 and **have not been checked against any invoice**. The largest and least certain line is WhatsApp (about 600 to 1,000 template messages at about 1 to 5 cents each); the Meta rate for Pakistan is the figure to confirm first.

| Line | Per month, USD |
|---|---|
| WhatsApp template messages | 10 to 40 |
| AI reading (Claude Haiku 5.5) | under 2 |
| Email | 0 to 2 |
| Files and data | under 1 |
| **Grows with the company** | **about 10 to 45** |
| Supabase (database, login, storage) | 25 to 60 |
| Netlify (hosting, scheduled jobs) | 19 to 40 |
| Domain, live chat, mail service | 5 to 20 |
| **Shared platform, whole company** | **about 60 to 100** |

Per company: 1 company 70 to 145; 10 companies 16 to 55; 25 companies 12 to 49. These sums are the arithmetic of the table; an earlier chat estimate (about 20 to 70 at ten companies) was looser and the flyer's figures replace it.

## Rules kept
- **No subscription price or revenue is on the flyer** (CLAUDE.md rule 7: the price lives in the plans table, not in the repository). Margin per company is therefore not stated there. A version with revenue can be made outside the repository on the owner's word.
- Every capability named is in the product today; the AI and job cards by WhatsApp are marked Pro and the footnote says they are built and live but not yet proven with a paying company. Gate passes and the vendor scorecard are not mentioned.
- The footnotes say the figures are estimates, not quotes, and are to be replaced by measured costs.

## To do when real invoices exist
Replace the ranges with measured costs (Meta, Supabase, Netlify, the mail service) and re-render.
