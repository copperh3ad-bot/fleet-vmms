import { Suspense } from "react";
import { connection } from "next/server";
import { pageMeta } from "@/lib/site";
import { SiteShell } from "@/components/site-shell";
import { LegalPage } from "@/components/legal";
import { TERMS_VERSION } from "@/lib/orgs/signup";
import { getDriver } from "@/lib/db";
import { loadPlatformSettings } from "@/lib/billing/settings";
import { LOCK_RETENTION_DAYS, legalFacts } from "@/lib/legal";

export const metadata = pageMeta("Privacy policy · Fleet OTG", "What personal information Fleet OTG collects, why, who handles it, how long it is kept, and the choices you have.");

export default function PrivacyPage() {
  return <Suspense fallback={<SiteShell><p className="p-6 text-sm text-zinc-500">Loading</p></SiteShell>}><Privacy /></Suspense>;
}

// A balanced draft (ADR-032). It separates the two roles we have: for our own sign-up, billing and security records we decide what
// is done with the data; for an organization's fleet records the organization decides and we process them for it. The providers named
// here are the ones the service actually uses; when one changes, change this list in the same commit (a test checks the list).
async function Privacy() {
  await connection();
  const f = legalFacts(await loadPlatformSettings(getDriver()).catch(() => ({} as Record<string, string>)));
  return (
    <LegalPage title="Privacy policy">
      <p>Version {TERMS_VERSION}. {f.name}, of {f.address} (&ldquo;we&rdquo;, &ldquo;us&rdquo;), runs Fleet OTG. This page says what personal information we handle, why, who else handles it, how long we keep it, and what you can do about it. It goes with our <a href="/terms" className="underline">Terms of service</a>.</p>

      <h2>1. Two roles</h2>
      <ul>
        <li><strong>Our own records.</strong> For the details you give us to sign up, to be billed, to get support and to keep the service secure, we decide why and how the information is used. We are responsible for it.</li>
        <li><strong>Your organization&apos;s fleet records.</strong> Vehicles, job cards, quotations, invoices, odometer readings, documents, accidents, fines, budgets, the people in your records, and the files you attach are entered by your organization. Your organization decides why and how they are used, and we handle them only to run the service for it. If you are a driver, employee or workshop contact in such records, your organization is the one to ask about them (see section 8).</li>
      </ul>

      <h2>2. What we collect</h2>
      <ul>
        <li><strong>Sign-up and account details:</strong> organization name, your name, email address, phone number (optional), country, fleet size, the version of the terms you accepted, and your sign-in details. Your password is not readable by us; it is held in protected form by our sign-in provider.</li>
        <li><strong>Records people enter into a workspace:</strong> employee and driver names, codes, roles, phone numbers and sign-in names; vehicle details and who held a vehicle and when; workshop and supplier contacts; job cards, quotations, invoices, odometer readings, accidents and fines; documents and photographs attached to them; and a history of who changed what and when.</li>
        <li><strong>One-time links:</strong> when your administrator sends an invitation, an odometer link or a workshop estimate link, we store a protected fingerprint of the link (not the link itself), who it is for, and when it was used. The phone number a link is meant for is the one your administrator entered; the link is sent from your administrator&apos;s own phone, not by us.</li>
        <li><strong>Payment records:</strong> the bank transfers you tell us about, the reference, amount, date, any receipt or transfer number you upload, our invoices, and any tax withholding certificate.</li>
        <li><strong>Messages to us:</strong> what you write in the Contact form (name, email, company, topic, message) and in emails to our support addresses.</li>
        <li><strong>Technical data:</strong> your internet address and the pages you ask for are seen by our hosting provider when you use the site, and may appear in its security and error logs. To slow down abuse we count attempts per address; the counter is kept in scrambled (hashed) form and for a short time only.</li>
      </ul>
      <p>We do not collect payment card details, do not track your location, and do not use advertising or analytics trackers.</p>

      <h2>3. Why we use it, and on what basis</h2>
      <ul>
        <li>To provide the service you or your organization signed up for, including sign-in, workspaces, links, notifications and support. <em>(To perform our agreement with you.)</em></li>
        <li>To bill you, confirm payments, issue invoices and meet tax and accounting rules. <em>(To perform our agreement and to meet legal duties.)</em></li>
        <li>To keep the service secure, prevent abuse and fix faults, including the record of who changed what. <em>(Our legitimate interest in running a safe service, and yours.)</em></li>
        <li>To answer your messages and to tell your administrator about your account, a change to the terms, or a problem. <em>(To perform our agreement and our legitimate interest.)</em></li>
      </ul>
      <p>We do not sell personal information. We do not use your organization&apos;s records for advertising, and we do not use them to train models or build products for others.</p>

      <h2>4. Who else handles it</h2>
      <p>We use these providers to run the service. Each handles personal information only on our behalf and for the purpose shown:</p>
      <ul>
        <li><strong>Supabase</strong>: database, sign-in and file storage. The database and files for the live service are in Tokyo, Japan.</li>
        <li><strong>Netlify</strong>: hosts the website and runs its server code; may keep technical logs.</li>
        <li><strong>Resend</strong>: sends the sign-up confirmation and password-reset emails. It sees the recipient&apos;s email address and the text of the message.</li>
        <li><strong>Zoho Mail</strong>: our mailboxes. It handles the emails you send to our support, sales and billing addresses and our replies.</li>
      </ul>
      <p>We also share information when the law requires it, with a court or authority acting lawfully, or to protect our rights or others&apos; safety, and with a successor if the business is sold, on terms that keep this policy. Within your organization, only the people your administrator has given access can see your records. Our staff do not open an organization&apos;s records except to fix a problem you report, and then only as much as is needed.</p>

      <h2>5. Where it goes</h2>
      <p>These providers run in other countries than yours, including Japan and the United States. By using the service you accept that your information is handled there. We rely on our providers&apos; contractual and security commitments to protect it, and we use only providers that offer them.</p>

      <h2>6. How we protect it</h2>
      <p>Each organization&apos;s records are kept apart from every other organization&apos;s and are only reachable after sign-in or through a one-time link. Links can be used once and expire. Sign-in details and connection secrets are stored in protected form, and we record who changed what. No system is completely secure. If we learn that your personal information has been exposed in a way that is likely to harm you, we will tell your administrator without undue delay, so that you can be told.</p>

      <h2>7. How long we keep it</h2>
      <ul>
        <li><strong>Sign-up and account details</strong> while your organization has a workspace.</li>
        <li><strong>Fleet records</strong> while your workspace is active. After it locks we keep them for {LOCK_RETENTION_DAYS} days, and may delete them afterwards, or sooner if you ask. Copies may remain in our providers&apos; backups for a limited time.</li>
        <li><strong>Payment records, invoices and withholding certificates</strong> for as long as tax and accounting law requires.</li>
        <li><strong>The record of who changed what</strong> while it is needed for security and accountability, and as long as the records it relates to are kept.</li>
        <li><strong>Contact messages</strong> until they are handled, and handled messages for up to a year.</li>
        <li><strong>Attempt counters</strong> for about an hour.</li>
      </ul>

      <h2>8. Your choices and rights</h2>
      <p>Depending on where you live, you may have the right to see, correct, delete, restrict, object to, or receive a copy of the personal information held about you, and to withdraw consent where we rely on it. For our own records, write to us at the address below and we will answer within a reasonable time, normally within 30 days. For fleet records, ask your own organization first, because it decides what they hold; we help it respond. Your organization&apos;s administrator can export its data at any time. You may also complain to the data-protection authority where you live. We may need to confirm who you are before we act, and we may refuse a request where the law allows it, and will say why.</p>

      <h2>9. Cookies</h2>
      <p>We use only the cookies needed to keep you signed in and to keep the service secure. We do not use advertising or tracking cookies, and the site does not need a cookie notice for anything else.</p>

      <h2>10. Children</h2>
      <p>Fleet OTG is for organizations and the working adults in them. It is not meant for anyone under 18, and we do not knowingly collect information from children.</p>

      <h2>11. Changes</h2>
      <p>If we change this policy in a way that matters, for example by adding a provider that handles personal information, we will tell your administrator by email and show the new version here with a new version number.</p>

      <h2>12. Contact</h2>
      <p>{f.name}, {f.address}. Privacy questions and requests: {f.privacy}.</p>
    </LegalPage>
  );
}
