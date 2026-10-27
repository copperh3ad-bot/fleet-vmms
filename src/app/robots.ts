import type { MetadataRoute } from "next";
import { PRIVATE_PREFIXES, SITE_URL } from "@/lib/site";

// Public pages may be listed; everything private is asked to be left alone. This is a request to well-behaved crawlers, not
// protection: every private address still needs a sign-in (src/lib/auth/routing.ts).
//
// The AI search and answer crawlers are named on purpose (ADR-031): the public pages are marketing text that the owner wants
// quoted accurately when someone asks an assistant about fleet maintenance software. A crawler that finds a rule naming it
// ignores the "*" rule, so each one repeats the private list. To keep a company out of model training, move its name from
// ANSWER_CRAWLERS to a `disallow: "/"` rule.
const ANSWER_CRAWLERS = [
  "OAI-SearchBot", "ChatGPT-User", "GPTBot",
  "Claude-SearchBot", "Claude-User", "ClaudeBot",
  "PerplexityBot", "Perplexity-User",
  "Google-Extended", "Applebot-Extended",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: [...PRIVATE_PREFIXES] },
      { userAgent: ANSWER_CRAWLERS, allow: "/", disallow: [...PRIVATE_PREFIXES] },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
