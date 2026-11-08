# ADR-064: Investor flyer and the monthly cost estimate for a 200-vehicle company

Status: accepted, 2026-11-08. Owner request: a flyer for investors estimating the monthly cost per organization of 200 vehicles, with the application's features and use cases. The flyer is `marketing/investor-flyer/` (HTML, two A4 pages, PDF and one PNG per page).

## What the numbers are
Planning estimates in US dollars a month, from the usage assumptions printed on the flyer (200 vehicles, about 50 people, about 200 job cards, about 400 AI-read documents, about 200 monthly odometer requests on WhatsApp, Pro plan with every job card raised by WhatsApp as the worst case). They have **not been checked against any invoice**.

**Revised 2026-11-08 with Meta's Pakistan rates supplied by the owner:** marketing $0.0473, utility $0.0150 (from 1 Oct 2026), authentication $0.0150, service replies free for the first 1,000 a month per business number and $0.0150 after. The platform has one business number, so the free 1,000 replies are shared by all companies.

| Line | Per month, USD |
|---|---|
| WhatsApp: 600 to 1,000 utility templates ($9 to 15) plus job card replies ($0 to 20) | 9 to 35 |
| AI reading (Claude Haiku 5.5) | under 2 |
| Email | 0 to 2 |
| Files and data | under 1 |
| **Grows with the company** | **about 10 to 40** |
| Supabase (database, login, storage) | 25 to 60 |
| Netlify (hosting, scheduled jobs) | 19 to 40 |
| Domain, live chat, mail service | 5 to 20 |
| **Shared platform, whole company** | **about 60 to 100** |

Per company, Pro: 1 company 70 to 126; 10 companies 16 to 50; 25 companies 12 to 44. Basic (no AI, no job card replies; about 10 to 18 variable): 1 company 70 to 118; 10 companies 16 to 28; 25 companies 12 to 22. These supersede the first figures (WhatsApp 10 to 40 at an assumed 1 to 5 cents a message; 70 to 145, 16 to 55, 12 to 49).

## Rules kept
- **No subscription price or revenue is on the flyer** (CLAUDE.md rule 7: the price lives in the plans table, not in the repository). Margin per company is therefore not stated there. A version with revenue can be made outside the repository on the owner's word.
- Every capability named is in the product today; the AI and job cards by WhatsApp are marked Pro and the footnote says they are built and live but not yet proven with a paying company. Gate passes and the vendor scorecard are not mentioned.
- The footnotes say the figures are estimates, not quotes, and are to be replaced by measured costs.

## To do when real invoices exist
Replace the ranges with measured costs (Meta, Supabase, Netlify, the mail service) and re-render.
