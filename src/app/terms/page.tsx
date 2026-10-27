import { Suspense } from "react";
import { connection } from "next/server";
import { pageMeta } from "@/lib/site";
import { SiteShell } from "@/components/site-shell";
import { LegalPage } from "@/components/legal";
import { TERMS_VERSION } from "@/lib/orgs/signup";
import { getDriver } from "@/lib/db";
import { loadPlatformSettings } from "@/lib/billing/settings";
import { LOCK_RETENTION_DAYS, legalFacts } from "@/lib/legal";

export const metadata = pageMeta("Terms of service · Fleet OTG", "The terms for using Fleet OTG: what the service is, who is responsible for what, how payment works, and what happens to your data.");

export default function TermsPage() {
  return <Suspense fallback={<SiteShell><p className="p-6 text-sm text-zinc-500">Loading</p></SiteShell>}><Terms /></Suspense>;
}

// A balanced draft (ADR-032): it protects the customer's ownership of its records and its right to leave with them, and it protects
// the owner from being answerable for decisions the service only records. Who "we" are, and the governing law, come from Settings.
async function Terms() {
  await connection();
  const f = legalFacts(await loadPlatformSettings(getDriver()).catch(() => ({} as Record<string, string>)));
  return (
    <LegalPage title="Terms of service">
      <p>Version {TERMS_VERSION}. These terms are between {f.name}{f.registration ? ` (registration ${f.registration})` : ""}, of {f.address} (&ldquo;we&rdquo;, &ldquo;us&rdquo;), and the company or other organization that signs up (&ldquo;you&rdquo;). Fleet OTG is for organizations, not for individuals using it for personal purposes. By signing up or using the service you accept these terms for your organization.</p>

      <h2>1. The service</h2>
      <p>Fleet OTG is web software for managing the maintenance of vehicles and equipment: job cards and their approvals, workshop quotations and invoices, odometer readings, servicing rules, budgets, vehicle documents, accidents and fines, and reports. Your organization gets its own workspace, kept apart from every other organization&apos;s.</p>
      <p>Fleet OTG records and organizes what you and your people enter. It is a management tool. It does not give legal, tax, accounting, engineering or safety advice, and it does not inspect any vehicle. Reminders, due dates and flags are aids and may be wrong or late if the information entered is wrong or late. Where an organization switches on AI reading of workshop documents, the AI only fills in a draft: it can misread a document, so the person who saves it is responsible for checking every figure against the original. Keeping vehicles safe, roadworthy, insured and legal remains your responsibility.</p>

      <h2>2. Your account and your people</h2>
      <ul>
        <li>The person who signs up becomes the administrator. You confirm that they are authorized to bind your organization to these terms.</li>
        <li>You decide who else gets access and what each person may do. You are responsible for what your users do in your workspace and for keeping sign-in details private. Tell us promptly if you think an account has been misused.</li>
        <li>You are responsible for having the right to enter your employees&apos;, drivers&apos; and workshops&apos; information into the service, and for telling those people what you do with it.</li>
        <li>Some people use one-time links (a driver&apos;s odometer link, a workshop&apos;s estimate link, an invitation). Whoever opens a link first can use it. Send each link only to the person it is meant for, on the number you have checked.</li>
      </ul>

      <h2>3. Workshops and other third parties</h2>
      <p>Workshops, suppliers and other businesses you deal with through the service are your counterparties, not ours. Quotations, invoices, repairs and payments between you and a workshop are agreements between you and that workshop. We are not a party to them, we do not check the quality of any repair, and we are not responsible for a workshop&apos;s work, prices or conduct.</p>

      <h2>4. Free trial</h2>
      <p>A new organization gets a free trial with every feature, for the length of time shown when you sign up. No payment details are taken. When the trial ends the workspace locks until you subscribe. Nothing is deleted when it locks (see section 7).</p>

      <h2>5. Price, tax and payment</h2>
      <ul>
        <li>The subscription price is shown on our pricing page and on the Billing page of your workspace. It is per organization, not per person, and includes every feature. We set prices in US dollars. Where an amount is shown or accepted in another currency, the exchange rate used is shown on the Billing page and on the invoice.</li>
        <li>We may change the price. A change applies to the next period you pay for, and we will tell your administrator by email at least 30 days before it applies. If you do not accept it, you can stop before it takes effect.</li>
        <li>For organizations in Pakistan we add the sales tax that applies and show it on the invoice. For organizations elsewhere we do not charge Pakistani tax. Any tax, duty or levy that applies to you in your own country is yours to pay. If the law requires you to withhold tax from a payment to us, withhold only what the law requires and send us the withholding certificate.</li>
        <li>For now you pay by direct bank transfer to the account shown on your Billing page, using the payment reference shown there, and you send us the receipt. A payment counts once we have confirmed it against our bank. We then issue the invoice, which appears in your workspace.</li>
        <li>Fees are charged for the period you subscribe for and are not refunded when you stop part-way through it, except where we made a billing error or the law requires a refund. Stopping takes effect at the end of the period you have paid for.</li>
        <li>If a payment is not made by the end of the period, the workspace locks as described in section 7.</li>
      </ul>

      <h2>6. Your data</h2>
      <ul>
        <li>Your records belong to you. We do not own them, sell them or use them for advertising. You give us the right to store and process them only as needed to provide the service to you, keep it secure, and meet our legal duties.</li>
        <li>You can export your data at any time, including while your workspace is locked.</li>
        <li>How we handle personal data is set out in our <a href="/privacy" className="underline">Privacy policy</a>. For the personal data in your records, you decide why and how it is used and we process it on your instructions, as the Privacy policy describes. If your law requires a separate data-processing agreement, ask us and we will provide one.</li>
        <li>We keep your records separate from every other organization&apos;s and take reasonable technical and organizational steps to protect them. No system is completely secure, and we cannot promise that nothing will ever go wrong. If we find that your records were exposed, we will tell your administrator without undue delay.</li>
      </ul>

      <h2>7. If the workspace locks, or you leave</h2>
      <ul>
        <li>When a trial or paid period ends without payment, the workspace locks: people can sign in, see the Billing page and export your data, but cannot add or change records, and one-time links and invitations stop working.</li>
        <li>We keep your data for {LOCK_RETENTION_DAYS} days after a lock. After that we may delete it, and copies may remain in our providers&apos; backups for a limited time. You can ask us to delete it sooner. Records we must keep for tax, accounting or security reasons are kept as long as the law or those needs require.</li>
        <li>Subscribing again within that time restores the workspace as it was.</li>
      </ul>

      <h2>8. Acceptable use</h2>
      <p>Do not use the service to break the law, to store content you have no right to store, to attack, probe or overload it, to get around its limits or its approval rules, to reverse-engineer it, or to resell it or give access to people outside your organization without our written agreement. We may suspend access that does any of this, after notice where we can give it.</p>

      <h2>9. Our property, and your feedback</h2>
      <p>The software, its design and its text are ours or our licensors&apos;. You get the right to use it as a subscriber for your own organization, for as long as these terms apply, and no more. If you suggest an improvement we may use it without owing you anything, and we will not name you without your agreement.</p>

      <h2>10. Availability and support</h2>
      <p>We aim to keep the service running and to fix faults quickly, but we do not promise it will never be interrupted, and we may pause it for maintenance, with notice where we can. Support is by email at {f.support} and is answered on working days. We do not offer a guaranteed response or uptime time unless we agree one with you in writing.</p>

      <h2>11. What we promise, and what we do not</h2>
      <p>We will provide the service with reasonable care and skill. Beyond that, to the extent the law allows, the service is provided &ldquo;as is&rdquo;, and we do not promise that it will be free of errors, that it will meet every need of yours, or that results such as costs, flags and reminders will be complete or correct. You are responsible for deciding what to approve, repair, pay and report, and for checking what matters.</p>

      <h2>12. Limit of liability</h2>
      <ul>
        <li>To the extent the law allows, neither of us is liable to the other for indirect or consequential loss, or for lost profit, lost business, or loss of goodwill, even if it was foreseeable.</li>
        <li>To the extent the law allows, our total liability to you for everything that arises from these terms or the service in any 12 months is limited to the fees you paid us for that period.</li>
        <li>We are not liable for loss caused by a workshop or other third party, by information you entered wrongly, by your decisions about vehicles, repairs, payments or safety, or by events outside our reasonable control.</li>
        <li>Nothing in these terms limits liability that cannot be limited by law, such as for fraud or for death or personal injury caused by negligence.</li>
      </ul>

      <h2>13. Claims by third parties</h2>
      <ul>
        <li>You will cover us against claims from third parties that arise because you entered data you had no right to enter, or used the service unlawfully or against these terms.</li>
        <li>We will cover you against claims from third parties that the service itself, used as these terms allow, infringes their copyright or other intellectual property rights. We may change the service, or end the affected part and refund the unused part of what you paid, to remove such a claim.</li>
        <li>The covered party must tell the other promptly, let it run the defence, and cooperate. Neither may settle in a way that binds the other without agreement.</li>
      </ul>

      <h2>14. Ending the agreement</h2>
      <p>You can stop at any time by not paying for the next period (section 5). We may suspend or end an account that breaks these terms, with notice where we can give it, or end the service as a whole with at least 60 days&apos; notice, in which case we will refund the fees you have paid for any period after it ends. Sections that by their nature should continue, such as those on payment owed, liability, third-party claims, and governing law, continue after the agreement ends.</p>

      <h2>15. Changes to these terms</h2>
      <p>If we change these terms in a way that matters, we will tell your administrator by email and show the new version here with a new version number, at least 30 days before it applies. If you do not accept it, you can stop before it takes effect. If you keep using the service after that date, the new version applies.</p>

      <h2>16. Governing law and disputes</h2>
      <p>These terms are governed by {f.law}. If we disagree, each of us will first try in good faith to settle it by talking, for at least 30 days after one tells the other in writing, before starting any court case.</p>

      <h2>17. General</h2>
      <ul>
        <li>These terms, and the pages they refer to, are the whole agreement between us about the service. If part of them cannot be enforced, the rest continues.</li>
        <li>You may not transfer your rights under these terms without our written agreement. We may transfer ours to a successor of the business and will tell you.</li>
        <li>Neither of us is responsible for delay or failure caused by events outside our reasonable control, other than a duty to pay.</li>
        <li>Notices to you go by email to your administrator. Notices to us go to the contact below.</li>
      </ul>

      <h2>18. Contact</h2>
      <p>{f.name}, {f.address}. Email: {f.support}.</p>
    </LegalPage>
  );
}
