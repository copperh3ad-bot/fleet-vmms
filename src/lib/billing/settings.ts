// Settings the operator edits on the operator screen: where customers send payments, who the invoices are from, the
// PKR rate. They are business details, not secrets, and they live in the control database, not in the repository.
import type { Driver } from "@/lib/db/types";
import { withPlatform } from "@/lib/db/tenant";
import { UserError } from "@/lib/master/service";

export type SettingDef = {
  key: string; label: string; hint: string; multiline?: boolean; max: number; numeric?: boolean;
  /** a percent from 0 to 100, two decimals; 0 is allowed */ percent?: boolean;
  /** the only values accepted */ oneOf?: string[];
};

export const PLATFORM_SETTINGS: SettingDef[] = [
  { key: "bank_details", label: "Bank account for payments", hint: "Shown to customers on their billing page: bank, account title, account number or IBAN, branch. One item per line.", multiline: true, max: 800 },
  { key: "payment_note", label: "Payment instructions", hint: "Anything customers should know when they pay, for example how long a confirmation takes.", multiline: true, max: 600 },
  { key: "pkr_per_usd", label: "PKR per USD (fallback)", hint: "Used when there is no dated rate for the day a customer paid (see the Rates page), and for the amount shown before a customer pays if no rate has been fetched or entered. Leave empty to show dollars only.", max: 12, numeric: true },
  { key: "fx_side", label: "Which rate converts the price", hint: "Type buying, selling or average: the interbank buying rate, the selling rate, or the middle of the two. Ask your accountant which the tax authority expects. If empty, buying is used.", max: 8, oneOf: ["buying", "selling", "average"] },
  { key: "fx_forexpk_consent", label: "Automatic rates from forex.pk: written consent", hint: "forex.pk's terms of use do not allow commercial use of its pages without its prior written consent. Fetching its rates automatically stays OFF until you write here who gave consent and when (for example: email from forex.pk, 12 Nov 2026). Leave empty to enter rates by hand.", max: 200 },
  { key: "company_details", label: "Seller details on invoices", hint: "Your company name, address and tax number as they should appear on an invoice. One item per line.", multiline: true, max: 600 },
  { key: "pro_offer_min_job_cards", label: "Pro is offered above this many job cards a day", hint: "Pro (the AI plan) is offered as an upgrade to organizations that enter more than this many job cards a day, on average over the last 30 days. Empty means 20.", max: 6, numeric: true },
  { key: "support_email", label: "Support email", hint: "Shown on the Contact page for help with an account or a question. For example support@yourdomain.", max: 120 },
  { key: "billing_email", label: "Billing email", hint: "Shown on the customer's Billing page for payment questions. If empty, the support email is shown there instead.", max: 120 },
  { key: "sales_email", label: "Sales email", hint: "Shown on the Pricing and Contact pages for people who want to talk to someone before they sign up.", max: 120 },

  // ---- Tax invoices for customers in Pakistan (ADR-017). Nothing is taxed until a seller registration number is set here. ----
  { key: "seller_legal_name", label: "Seller: name on tax invoices", hint: "The name of the person or company that receives the money and issues the invoice, exactly as registered. For an individual, the full name as on the CNIC.", max: 160 },
  { key: "legal_address", label: "Legal: registered address", hint: "The postal address of the company or person that runs Fleet OTG. Printed in the Terms and the Privacy policy. The legal name is the 'Seller: name on tax invoices' setting.", max: 240 },
  { key: "legal_registration", label: "Legal: registration number", hint: "Company or business registration number, if there is one. Printed in the Terms. Optional.", max: 60 },
  { key: "legal_jurisdiction", label: "Legal: governing law and courts", hint: "The law that governs the Terms and the courts that hear disputes, as your lawyer words it. For example: the laws of Pakistan, and the courts of Lahore.", max: 200 },
  { key: "seller_ntn", label: "Seller: NTN", hint: "National Tax Number of the seller, printed on every tax invoice.", max: 20 },
  { key: "seller_tax_reg", label: "Seller: sales tax registration number", hint: "The number the seller is registered under for sales tax on services (STRN or the province's own number). Sales tax is only charged on an invoice when this is filled in.", max: 30 },
  { key: "seller_pseb_no", label: "Seller: PSEB registration number", hint: "Pakistan Software Export Board registration, printed on tax invoices. Optional.", max: 40 },
  { key: "wht_income_pct_default", label: "Income tax a withholding customer keeps back (%)", hint: "The usual percent a customer that withholds keeps back from what it owes you, and pays to the government for you. A customer can be given its own percent on its organization page. Ask your accountant; it depends on your filer status and the kind of service.", max: 6, percent: true },
  { key: "wht_sales_share_pct_default", label: "Share of the sales tax a withholding customer keeps back (%)", hint: "Some withholding customers keep back all of the sales tax, some a part, some none. 0 to 100.", max: 6, percent: true },
  { key: "wht_certificate_section", label: "Section shown on withholding certificates", hint: "The provision of the tax law under which customers withhold from you, as your accountant words it. Printed on each certificate. Optional.", max: 120 },
  { key: "wht_income_base", label: "Income tax is worked out on", hint: "Type subtotal (the price before sales tax) or total (the price with sales tax). Ask your accountant. If empty, subtotal is used.", max: 8, oneOf: ["subtotal", "total"] },
];

export type PlatformSettings = Record<string, string>;

export function loadPlatformSettings(driver: Driver): Promise<PlatformSettings> {
  return withPlatform(driver, async (q) => Object.fromEntries((await q.query<{ key: string; value: string }>("select key, value from public.platform_settings")).rows.map((r) => [r.key, r.value])));
}

/** Checks one setting. Empty clears it. Numbers must be plain positive numbers. */
export function checkPlatformSetting(key: string, raw: string): string {
  const def = PLATFORM_SETTINGS.find((d) => d.key === key);
  if (!def) throw new UserError("Unknown setting.");
  const v = raw.replace(/\r\n/g, "\n").trim();
  if (v.length > def.max) throw new UserError(`${def.label} is too long (at most ${def.max} characters).`, { [key]: "Too long" });
  if (def.percent && v !== "" && (!/^\d{1,3}(\.\d{1,2})?$/.test(v) || Number(v) > 100)) throw new UserError("Enter a percent from 0 to 100, like 8 or 4.5.", { [key]: "Enter a percent from 0 to 100" });
  if (def.oneOf && v !== "" && !def.oneOf.includes(v)) throw new UserError(`Type ${def.oneOf.join(" or ")}.`, { [key]: `Type ${def.oneOf.join(" or ")}` });
  if (def.numeric && v !== "") {
    if (!/^\d{1,6}(\.\d{1,4})?$/.test(v) || Number(v) <= 0 || Number(v) > 100000) throw new UserError("Enter a number like 280.5.", { [key]: "Enter a number like 280.5" });
  }
  if (/_email$/.test(key) && v !== "" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw new UserError("Enter a valid email address.", { [key]: "Enter a valid email address" });
  return v;
}

/** Saved by an operator only (the caller checks); the actor is recorded for the audit log. */
export function savePlatformSetting(driver: Driver, operatorId: string, key: string, raw: string): Promise<void> {
  const value = checkPlatformSetting(key, raw);
  return withPlatform(driver, async (q) => {
    await q.query("select set_config('app.user_id', $1, true)", [operatorId]);
    if (value === "") await q.query("delete from public.platform_settings where key = $1", [key]);
    else await q.query(
      `insert into public.platform_settings(key, value, updated_by) values ($1, $2, $3)
       on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`, [key, value, operatorId]);
  });
}
