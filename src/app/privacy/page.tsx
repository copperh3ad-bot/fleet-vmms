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
      <p>Version {TERMS_VERSION}. Last updated 7 November 2026. {f.name}, of {f.address} (&ldquo;we&rdquo;, &ldquo;us&rdquo;), runs Fleet OTG. This page says what personal information we handle, why, who else handles it, how long we keep it, and what you can do about it. It goes with our <a href="/terms" className="underline">Terms of service</a>.</p>

      <h2>1. Two roles</h2>
      <ul>
        <li><strong>Our own records.</strong> For the details you give us to sign up, to be billed, to get support and to keep the service secure, we decide why and how the information is used. We are responsible for it.</li>
        <li><strong>Your organization&apos;s fleet records.</strong> Vehicles, job cards, quotations, invoices, odometer readings, documents, accidents, fines, budgets, the people in your records, and the files you attach are entered by your organization. Your organization decides why and how they are used, and we handle them only to run the service for it. If you are a driver, employee or workshop contact in such records, your organization is the one to ask about them (see section 8).</li>
      </ul>

      <h2>2. What we collect</h2>
      <ul>
        <li><strong>Sign-up and account details:</strong> organization name, your name, email address, phone number (optional), country, fleet size, the version of the terms you accepted, and your sign-in details. Your password is not readable by us; it is held in protected form by our sign-in provider.</li>
        <li><strong>Trips, if your organization switches them on:</strong> a request to use a vehicle (who asked, the purpose, where from and to, the times), who approved it, the vehicle and the driver assigned, and pick-and-drop runs for staff, which name the staff member and the places. These are fleet records of your organization (section 1) and are kept and deleted with them.</li>
        <li><strong>Records people enter into a workspace:</strong> employee and driver names, codes, roles, phone numbers and sign-in names; if your organization records them, a driver&apos;s driving licence number, class, dates and emergency contact (shown in full only to people who manage employees or compliance, and never written in full to the history of changes); vehicle details and who held a vehicle and when; workshop and supplier contacts; job cards, quotations, invoices, odometer readings, accidents and fines; documents and photographs attached to them; and a history of who changed what and when.</li>
        <li><strong>A driving licence, for people who join or are invited:</strong> its number, whether it is a full licence or a learner&apos;s permit, and its expiry date, given when a person is invited or asks to join a company with its code. Until the administrator decides, a request to join holds it in the company&apos;s records; once approved it becomes the employee&apos;s licence, and if declined or never confirmed it is deleted. Licence numbers are shown in full only to people who manage employees or compliance and never written in full to the history of changes.</li>
        <li><strong>One-time links:</strong> when your administrator invites someone, or an organization sends a driver an odometer link or a workshop an estimate link, we store a protected fingerprint of the link (not the link itself), who it is for, and when it was used. The phone number a link is meant for is the one your administrator or staff entered. An invitation is sent to that number by us, from the Fleet OTG WhatsApp number, so that nobody in the organization holds the link and nobody can sign up in someone else&apos;s name.</li>
        <li><strong>WhatsApp messages:</strong> the phone number a message is sent to (entered by an administrator or staff member of an organization), the first name or full name and the organization&apos;s name that appear in an invitation, the one-time code we send to confirm an invitation, and whether the message was sent, delivered, read or failed. If someone replies to a message from our WhatsApp number, for example a workshop sending an estimate, we keep the phone number it came from, the text and any photo or document attached, on the organization&apos;s job card, so staff can enter the figures. See section 9.</li>
        <li><strong>Payment records:</strong> the payments you tell us about, the reference, amount, date, any receipt or reference you upload, and our invoices.</li>
        <li><strong>Replies from workshops:</strong> when a workshop replies to an email an organization sent it, we keep the sender&apos;s address, the subject, the text it wrote and any photos or PDFs attached, on that organization&apos;s job card, so staff can enter the figures.</li>
        <li><strong>Messages to us:</strong> what you write in the Contact form (name, email, company, topic, message), in emails to our support addresses and in the live chat.</li>
        <li><strong>Technical data:</strong> your internet address and the pages you ask for are seen by our hosting provider when you use the site, and may appear in its security and error logs. To slow down abuse we count attempts per address; the counter is kept in scrambled (hashed) form and for a short time only.</li>
      </ul>
      <p>We do not collect payment card details, do not use advertising or analytics trackers, and do not track your location, apart from what the live chat works out from your internet address when it is switched on (see Zoho SalesIQ below).</p>

      <h2>3. Why we use it, and on what basis</h2>
      <ul>
        <li>To provide the service you or your organization signed up for, including sign-in, workspaces, links, notifications and support. <em>(To perform our agreement with you.)</em></li>
        <li>To bill you, confirm payments, issue invoices and meet our legal duties. <em>(To perform our agreement and to meet legal duties.)</em></li>
        <li>To keep the service secure, prevent abuse and fix faults, including the record of who changed what. <em>(Our legitimate interest in running a safe service, and yours.)</em></li>
        <li>To answer your messages and to tell your administrator about your account, a change to the terms, or a problem. <em>(To perform our agreement and our legitimate interest.)</em></li>
        <li>To send, on an organization&apos;s instructions, the WhatsApp messages described in section 9: invitations, one-time codes and requests to workshops, and to file the replies. <em>(To perform our agreement with the organization, and its legitimate interest in running its fleet.)</em></li>
      </ul>
      <p>We do not sell personal information. We do not use your organization&apos;s records for advertising, and we do not use them to train models or build products for others. The only AI use of them is the optional reading of workshop documents described under Anthropic below, which each organization switches on or off itself.</p>

      <h2>4. Who else handles it</h2>
      <p>We use these providers to run the service. Each handles personal information only on our behalf and for the purpose shown:</p>
      <ul>
        <li><strong>Supabase</strong>: database, sign-in and file storage. The database and files for the live service are in Tokyo, Japan.</li>
        <li><strong>Netlify</strong>: hosts the website and runs its server code; may keep technical logs.</li>
        <li><strong>Resend</strong>: sends the sign-up confirmation and password-reset emails, and the emails an organization sends its workshops, and receives the replies workshops send to them. It sees the sender&apos;s and recipient&apos;s email addresses and the text and attachments of the message.</li>
        <li><strong>Anthropic</strong> (the Claude AI service): only if your organization&apos;s administrator switches on AI reading of workshop documents. A person then chooses to have a file a workshop emailed read by the AI, and that file, the job card number, the currency and, for an invoice, the lines of the approved estimate are sent to Anthropic to be read. No names, vehicles or other records are sent. Anthropic does not use this data to train its models. The AI only makes a draft; a person checks and saves it, and each use is recorded on the job card.</li>
        <li><strong>Zoho SalesIQ</strong> (live chat): when the chat button is switched on, it appears on our public pages and inside your workspace, and Zoho&apos;s chat service loads on those pages. It may record the page you are on, your browser, and your internet address with the country or city that implies, so our team can see who is chatting, and it keeps the messages you send us in the chat. From inside a workspace it is told your company&apos;s name, workspace, plan and status, never your name or email unless you type them. It sets its own cookies to keep a conversation going. It is not used for advertising.</li>
        <li><strong>WhatsApp Business Platform, provided by Meta Platforms</strong> (&ldquo;Meta&rdquo;): sends and receives the WhatsApp messages described in section 9. Meta sees the phone number a message is sent to or comes from, the message and its attachments, and the delivery status, and handles them under its own terms and privacy policy (<a href="https://www.whatsapp.com/legal/privacy-policy" className="underline">WhatsApp Privacy Policy</a>, <a href="https://www.whatsapp.com/legal/business-terms" className="underline">WhatsApp Business Terms</a>). We do not use social-media sign-in, and we receive no profile, contacts or other information from anyone&apos;s WhatsApp account beyond the phone number and the messages they send to us.</li>
        <li><strong>Zoho Mail</strong>: our mailboxes. It handles the emails you send to our support, sales and billing addresses and our replies.</li>
      </ul>
      <p>We also share information when the law requires it, with a court or authority acting lawfully, or to protect our rights or others&apos; safety, and with a successor if the business is sold, on terms that keep this policy. Within your organization, only the people your administrator has given access can see your records. Our staff do not open an organization&apos;s records except to fix a problem you report, and then only as much as is needed.</p>

      <h2>5. Where it goes</h2>
      <p>These providers run in other countries than yours, including Japan and the United States (where Meta and some of our other providers operate). By using the service you accept that your information is handled there. We rely on our providers&apos; contractual and security commitments to protect it, and we use only providers that offer them.</p>

      <h2>6. How we protect it</h2>
      <p>Each organization&apos;s records are kept apart from every other organization&apos;s and are only reachable after sign-in or through a one-time link. Links can be used once and expire. Sign-in details and connection secrets are stored in protected form, and we record who changed what. No system is completely secure. If we learn that your personal information has been exposed in a way that is likely to harm you, we will tell your administrator without undue delay, so that you can be told.</p>

      <h2>7. How long we keep it</h2>
      <ul>
        <li><strong>Sign-up and account details</strong> while your organization has a workspace.</li>
        <li><strong>Fleet records</strong> while your workspace is active. After it locks we keep them for {LOCK_RETENTION_DAYS} days, and may delete them afterwards, or sooner if you ask. Copies may remain in our providers&apos; backups for a limited time.</li>
        <li><strong>Payment records and invoices</strong> for as long as the law requires.</li>
        <li><strong>The record of who changed what</strong> while it is needed for security and accountability, and as long as the records it relates to are kept.</li>
        <li><strong>WhatsApp messages we send</strong> are not stored by us beyond the record that an invitation or request was made. <strong>Replies we file</strong> stay on the organization&apos;s job card for as long as its fleet records are kept (above). Delivery results appear only in our hosting provider&apos;s technical logs, which are kept for a limited time and carry no phone numbers or message text.</li>
        <li><strong>Contact messages</strong> until they are handled, and handled messages for up to a year.</li>
        <li><strong>Attempt counters</strong> for about an hour.</li>
      </ul>

      <h2>8. Your choices and rights</h2>
      <p>Depending on where you live, you may have the right to see, correct, delete, restrict, object to, or receive a copy of the personal information held about you, and to withdraw consent where we rely on it. For our own records, write to us at the address below and we will answer within a reasonable time, normally within 30 days. For fleet records, ask your own organization first, because it decides what they hold; we help it respond. Your organization&apos;s administrator can export its data at any time. You may also complain to the data-protection authority where you live. We may need to confirm who you are before we act, and we may refuse a request where the law allows it, and will say why.</p>

      <h2>9. WhatsApp messages</h2>
      <p>We use WhatsApp only to deliver the service an organization has asked us for, and only to a number that an administrator or staff member of that organization has entered:</p>
      <ul>
        <li><strong>Invitations</strong> to join an organization&apos;s workspace, sent from the Fleet OTG WhatsApp number. The message names the person, names the organization, and carries a link that works once and expires.</li>
        <li><strong>One-time codes</strong> that confirm an invitation.</li>
        <li><strong>Confirming a request to join a company</strong>: when someone asks to join with a company code, we send a 6-digit code to the WhatsApp number they typed, and they type it on the page to confirm it was them. The code works for ten minutes, and we keep only a scrambled form of it. Nobody sees the request until it is confirmed, and an unconfirmed request is removed after a few days.</li>
        <li><strong>Monthly odometer requests</strong>, if the organization switches them on: a message to the person who holds a vehicle, naming the vehicle and the month and asking them to reply with the odometer reading. We keep the number they type, the number it came from (to check it is theirs) and the time, on the organization&apos;s odometer record, for the organization to review.</li>
        <li><strong>Requests to workshops</strong> to send an estimate or an invoice for a job card, and a short acknowledgement of a reply.</li>
      </ul>
      <p>We do not send advertising or promotions on WhatsApp, we do not message anyone who has not been named by an organization we serve, and we do not sell, rent or share these numbers or messages, or use them to train any model. We use only what is needed to deliver the message and file the reply. The organization is responsible for entering only numbers of people it has reason to contact for its fleet.</p>
      <p><strong>To stop receiving them:</strong> tell the organization that added your number, or write to us at the address in section 14 with the number, and we will stop messaging it. You can also block the Fleet OTG number in WhatsApp at any time.</p>

      <h2 id="delete-data">10. Deleting your data</h2>
      <p>You can ask us to delete the personal information we hold about you, including your phone number and any WhatsApp messages filed from it, at any time.</p>
      <ol>
        <li>Email <strong>{f.privacy}</strong> with the subject &ldquo;Delete my data&rdquo;. Say your name, the email address or phone number we hold, and the organization you were part of, if any.</li>
        <li>We may ask you to confirm it is you, for example by replying from the same email address or phone number.</li>
        <li>We will confirm within 7 days, and delete or anonymize what we hold within 30 days of confirming who you are.</li>
      </ol>
      <p>For records that belong to an organization (for example a job card that mentions a driver), the organization decides what is kept, so we pass your request to its administrator and tell you we have done so. We keep what the law requires us to keep, such as payment records, and will tell you what and why. An organization&apos;s administrator can also remove its own people and export its data in the service itself.</p>

      <h2>11. Cookies</h2>
      <p>We use only the cookies needed to keep you signed in and to keep the service secure, plus, when the live chat is switched on, the cookies Zoho&apos;s chat sets to keep a conversation going. We do not use advertising or tracking cookies.</p>

      <h2>12. Children</h2>
      <p>Fleet OTG is for organizations and the working adults in them. It is not meant for anyone under 18, and we do not knowingly collect information from children.</p>

      <h2>13. Changes</h2>
      <p>If we change this policy in a way that matters, for example by adding a provider that handles personal information, we will tell your administrator by email and show the new version here with a new version number.</p>

      <h2>14. Contact</h2>
      <p>{f.name}, {f.address}. Privacy questions, requests to stop WhatsApp messages and requests to delete data (section 10): {f.privacy}.</p>
    </LegalPage>
  );
}
