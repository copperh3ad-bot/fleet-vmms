import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";
import { SITE_URL } from "@/lib/site";

// The design's two typefaces, served from our own domain (next/font downloads them at build time).
const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

const TITLE = "Fleet OTG: Your Fleet Maintenance Manager";
const DESCRIPTION = "Job cards, approvals, workshops, budgets and servicing for company fleets, in one place";

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
    <html lang="en" className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">{children}</body>
    </html>
  );
}
