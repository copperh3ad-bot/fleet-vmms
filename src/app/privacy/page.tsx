import type { Metadata } from "next";
import { LegalPage } from "@/components/legal";
import { TERMS_VERSION } from "@/lib/orgs/signup";

export const metadata: Metadata = { title: "Privacy policy · Fleet VMMS" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy policy">
      <p>Version {TERMS_VERSION}. [Company legal name] (&ldquo;we&rdquo;) runs Fleet VMMS. This page says what we collect and why.</p>
      <h2>What we collect</h2>
      <ul>
        <li><strong>Sign-up details:</strong> company name, your name, email address, phone number (optional), fleet size.</li>
        <li><strong>Your company&apos;s records:</strong> vehicles, drivers and employees, job cards, quotations, invoices, odometer readings, documents, accidents, fines, budgets and the files you attach. You enter these; they stay in your company&apos;s own database.</li>
        <li><strong>Sign-in and security data:</strong> your email, a protected form of your password (held by our sign-in provider, Supabase), and records of who changed what.</li>
        <li><strong>Payment records:</strong> the details of bank transfers you tell us about, and the receipts you upload.</li>
      </ul>
      <h2>Why we use it</h2>
      <p>To run the service for you, to keep it secure, to confirm payments, and to contact your administrator about your account. We do not sell your data and we do not use your company&apos;s records for advertising.</p>
      <h2>Where it is kept</h2>
      <p>Each company has its own database at [database provider and region]. Sign-in data and files are held by Supabase at [region]. The site runs on Netlify. [List any other service that handles personal data.]</p>
      <h2>Who can see your records</h2>
      <p>Only the people your company administrator has given access to. Our staff do not open your company&apos;s records except to fix a problem you report, and then only as needed. [State the process for this.]</p>
      <h2>Keeping and deleting</h2>
      <p>You can export your data at any time. If you stop paying, we keep your data for [30] days after the lock, and may delete it after that. You can ask us to delete it sooner. Records of payments and access changes may be kept for [period] for accounting and security.</p>
      <h2>Your rights</h2>
      <p>You can ask to see, correct or delete personal data we hold about you. [State how, and the law that applies.]</p>
      <h2>Cookies</h2>
      <p>We use only the cookies needed to keep you signed in. We do not use advertising or tracking cookies.</p>
      <h2>Contact</h2>
      <p>[Privacy contact email and postal address.]</p>
    </LegalPage>
  );
}
