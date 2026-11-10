// Structured data (schema.org JSON-LD) for search and answer engines (ADR-031). Only facts the site already states in words:
// the name, the address, what the product is and the questions answered on the page. No ratings, reviews, addresses, founders or
// prices are made up, and the price is not repeated here because it lives in the plans table (ADR-014).
import { SITE_URL } from "@/lib/site";
import type { Faq } from "@/lib/faq";

export const SITE_NAME = "Fleet OTG";
export const SITE_SUMMARY = "Fleet maintenance management software: job cards with approvals, workshop quotations and invoices, servicing, budgets and vehicle papers for company fleets. The Pro plan adds trips, cargo and logistics for total fleet management.";

type Json = Record<string, unknown>;
const ORG_ID = `${SITE_URL}/#organization`;
const SITE_ID = `${SITE_URL}/#website`;

export const organizationLd = (): Json => ({
  "@context": "https://schema.org", "@type": "Organization", "@id": ORG_ID,
  name: SITE_NAME, url: SITE_URL, logo: `${SITE_URL}/fleetotg-logo.png`, description: SITE_SUMMARY,
});

export const websiteLd = (): Json => ({
  "@context": "https://schema.org", "@type": "WebSite", "@id": SITE_ID,
  name: SITE_NAME, url: SITE_URL, inLanguage: "en", publisher: { "@id": ORG_ID },
});

export const softwareLd = (): Json => ({
  "@context": "https://schema.org", "@type": "SoftwareApplication",
  name: SITE_NAME, url: SITE_URL, description: SITE_SUMMARY,
  applicationCategory: "BusinessApplication", applicationSubCategory: "Fleet maintenance management",
  operatingSystem: "Any device with a web browser", inLanguage: "en", publisher: { "@id": ORG_ID },
  featureList: [
    "Job cards with a recorded approval trail",
    "Workshop quotations compared with invoices before payment",
    "Workshop estimates sent through a one-time phone link",
    "Driver odometer readings through a phone link, with no app",
    "Servicing rules that show what is overdue or due soon",
    "Budgets per vehicle and repeat-repair flags",
    "Insurance, fitness, token tax, accident and fine records with expiry reminders",
  ],
});

export const faqLd = (faqs: Faq[]): Json => ({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});

/** `trail` is [name, path] from the home page down to the current page. */
export const breadcrumbLd = (trail: [string, string][]): Json => ({
  "@context": "https://schema.org", "@type": "BreadcrumbList",
  itemListElement: trail.map(([name, path], i) => ({ "@type": "ListItem", position: i + 1, name, item: `${SITE_URL}${path === "/" ? "" : path}` })),
});

export const webPageLd = (name: string, path: string, description: string): Json => ({
  "@context": "https://schema.org", "@type": "WebPage", name, description, url: `${SITE_URL}${path}`, inLanguage: "en",
  isPartOf: { "@id": SITE_ID }, publisher: { "@id": ORG_ID },
});

/** JSON for a <script type="application/ld+json"> tag. "<" is escaped so no text can close the tag early. */
export const ldString = (data: Json): string => JSON.stringify(data).replace(/</g, "\\u003c");
