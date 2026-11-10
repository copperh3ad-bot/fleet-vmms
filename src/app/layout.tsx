import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Sans_Condensed } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "@/lib/site";
import { JsonLd } from "@/components/json-ld";
import { organizationLd, websiteLd } from "@/lib/seo";
import { Suspense } from "react";
import { SupportChat } from "@/components/support-chat";

// The three typefaces (text, figures, condensed headings), served from our own domain (next/font downloads them at build time).
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const condensed = IBM_Plex_Sans_Condensed({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-plex-cond", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

const TITLE = "Fleet OTG: Fleet Maintenance and Operations Software";
const DESCRIPTION = "Fleet maintenance and operations software for company fleets. Maintenance on Basic: job cards, approvals, workshops, servicing and budgets. Trips, cargo, AI and WhatsApp on Pro.";

// What a shared link, a search result and a phone home screen show. The share picture is src/app/opengraph-image.png and the
// phone icon src/app/apple-icon.png (Next adds their tags). A page that sets its own title and description gets its own preview.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: "Fleet OTG",
  alternates: { canonical: "./" },
  openGraph: { type: "website", siteName: "Fleet OTG", locale: "en", title: TITLE, description: DESCRIPTION, url: "./" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${condensed.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        <JsonLd data={organizationLd()} />
        <JsonLd data={websiteLd()} />
        {children}
        <Suspense fallback={null}><SupportChat /></Suspense>
      </body>
    </html>
  );
}
