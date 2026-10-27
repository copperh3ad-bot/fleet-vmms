import type { Metadata } from "next";
// The public address of the site, used where an address must be absolute and there is no request to read it from (the
// sitemap, the robots file, link-preview tags). Pages that act on a request use src/lib/origin.ts instead. A different
// domain needs only NEXT_PUBLIC_SITE_URL set in Netlify. It is a public address, not a secret.
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://www.fleetotg.com").replace(/\/+$/, "");

/** Pages that search engines may list: the ones anyone can open and that say something. Sign-in and reset pages are left out. */
export const INDEXABLE_PATHS = ["/", "/features", "/about", "/pricing", "/contact", "/signup", "/join", "/terms", "/privacy"] as const;

/** Never to be crawled: private workspaces, the operator, one-person links, and the plumbing. */
export const PRIVATE_PREFIXES = ["/w/", "/admin", "/o/", "/q/", "/invite/", "/setup", "/auth/", "/api/", "/reset-password", "/forgot-password"] as const;

/** Title, description, and the matching link-preview tags for one page. The share picture comes from src/app/opengraph-image.png. */
export function pageMeta(title: string, description: string): Metadata {
  // A page that sets its own preview tags replaces the root ones, picture included, so the picture is named here again.
  const images = [{ url: "/opengraph-image.png", width: 1200, height: 630, alt: "Fleet OTG: your fleet maintenance manager" }];
  return {
    title, description,
    openGraph: { type: "website", siteName: "Fleet OTG", locale: "en", title, description, url: "./", images },
    twitter: { card: "summary_large_image", title, description, images: images.map((i) => i.url) },
  };
}
