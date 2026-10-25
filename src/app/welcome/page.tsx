import type { Metadata } from "next";
import { cacheLife } from "next/cache";
import { getDriver } from "@/lib/db";
import { loadOffer, type Offer } from "@/lib/billing/offer";
import { Landing } from "../landing";

// The signed-out home page. The proxy rewrites "/" here when there is no login cookie, so a visitor gets a page built ahead of
// time and served from the edge instead of one rebuilt, with a login check and a database read, on every visit. The address
// the visitor and crawlers see stays "/", so the link tags below name "/" and not "/welcome".
const TITLE = "Fleet OTG: Your Fleet Maintenance Manager";
const DESCRIPTION = "Job cards, approvals, workshops, budgets and servicing for company fleets, in one place";
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "Fleet OTG", locale: "en", title: TITLE, description: DESCRIPTION, url: "/", images: [{ url: "/opengraph-image.png", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION, images: ["/opengraph-image.png"] },
};

/** The price and trial length, kept for a few minutes. A failed read is kept for a second only, so a bad moment never sticks. */
async function cachedOffer(): Promise<Offer | null> {
  "use cache";
  const offer = await loadOffer(getDriver()).catch(() => null);
  cacheLife(offer ? { stale: 300, revalidate: 300, expire: 3600 } : { stale: 1, revalidate: 1, expire: 60 });
  return offer;
}

export default async function Welcome() {
  return <Landing offer={await cachedOffer()} />;
}
