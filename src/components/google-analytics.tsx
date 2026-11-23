"use client";
import Script from "next/script";
import { usePathname } from "next/navigation";

// Google Tag Manager (which carries the Google Analytics tag) on the public marketing pages only. Never in the workspace (/w), the operator
// area (/admin) or a one-time link (/o, /q, /invite): those carry company records or a secret in the path. The container ID is public by nature
// (it is in the page source of every site that uses it) but is still read from the environment, not the repository. Without it nothing loads.
// Add the Analytics tag inside the container, not here: a second Analytics tag on the page would count every visit twice.
const GTM_ID = process.env.NEXT_PUBLIC_GTM_ID;
const TRACKED = new Set(["/", "/pricing", "/compare", "/features", "/about", "/contact", "/signup", "/join", "/login", "/terms", "/privacy"]);

export function GoogleAnalytics() {
  const pathname = usePathname();
  if (!GTM_ID || !/^GTM-[A-Z0-9]+$/.test(GTM_ID) || !TRACKED.has(pathname)) return null;
  return (
    <Script id="gtm-init" strategy="afterInteractive">{`(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s);j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${GTM_ID}');`}</Script>
  );
}
