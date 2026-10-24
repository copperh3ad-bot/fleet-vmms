import type { MetadataRoute } from "next";
import { PRIVATE_PREFIXES, SITE_URL } from "@/lib/site";

// Public pages may be listed; everything private is asked to be left alone. This is a request to well-behaved crawlers, not
// protection: every private address still needs a sign-in (src/lib/auth/routing.ts).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: [...PRIVATE_PREFIXES] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
