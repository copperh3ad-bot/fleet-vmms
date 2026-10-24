import { pageMeta } from "@/lib/site";
import { LegalPage } from "@/components/legal";
import { TERMS_VERSION } from "@/lib/orgs/signup";

export const metadata = pageMeta("Terms of service · Fleet OTG", "The terms for using Fleet OTG.");

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service">
      <p>Version {TERMS_VERSION}. These terms are between [company legal name, registration number, address] (&ldquo;we&rdquo;) and the company that signs up (&ldquo;you&rdquo;).</p>
      <h2>The service</h2>
      <p>Fleet OTG is software for managing the maintenance of vehicles and equipment: job cards, approvals, workshops, odometer readings, budgets, documents and reports. Your company gets its own workspace and its own database.</p>
      <h2>Your account and your people</h2>
      <ul><li>The person who signs up is the administrator. You decide who else gets access and what they can do.</li><li>You are responsible for what your users do and for keeping their passwords private.</li><li>You must be authorised to sign up on behalf of your company.</li></ul>
      <h2>Free trial</h2>
      <p>New companies get a free trial of [3] days with every feature. No payment details are taken. When the trial ends the workspace locks until you subscribe.</p>
      <h2>Price and payment</h2>
      <ul><li>The subscription price is shown on our website when you sign up and is charged per company per month. It is set at about the monthly wage of an unskilled labourer, and the exact amount for your company is shown in the Billing page of your workspace.</li><li>For now you pay by direct bank transfer to the account shown in your billing page, and send us the receipt. A payment is counted when we have confirmed it in our bank. Other payment methods may be added.</li><li>Each payment extends your subscription by one month. If a payment is late there is a grace period of [5] days, after which the workspace locks until payment is confirmed.</li><li>We may change the price with at least [30] days&apos; notice. The change applies from your next period.</li><li>[Taxes: state how taxes are handled and who pays them.] [Refunds: state the refund policy.]</li></ul>
      <h2>Your data</h2>
      <ul><li>Your data belongs to you. We use it only to run the service for you.</li><li>You can export your data at any time, including while your workspace is locked.</li><li>If you stop paying we keep your data for [30] days after the lock. After that we may delete it. You can ask us to delete it sooner.</li></ul>
      <h2>Acceptable use</h2>
      <p>Do not use the service to break the law, to attack or probe it, to store content you have no right to store, or to resell it without our written agreement.</p>
      <h2>Availability and support</h2>
      <p>We aim to keep the service running but do not promise it will never be interrupted. [Describe support hours and how to reach support.]</p>
      <h2>Ending the agreement</h2>
      <p>You can stop at any time by not paying. We may suspend or end an account that breaks these terms, with notice where we can give it.</p>
      <h2>Liability</h2>
      <p>[State the limit of liability, what is excluded, and the law that applies. This section needs a lawyer.]</p>
      <h2>Changes to these terms</h2>
      <p>If we change these terms we will tell the account administrator by email and show the new version here with a new version number.</p>
      <h2>Contact</h2>
      <p>[Support email and postal address.]</p>
    </LegalPage>
  );
}
