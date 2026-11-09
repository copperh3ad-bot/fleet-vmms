// How the operator's Settings screen groups the settings, so sixty lines of boxes become a few sections that can be searched and folded. Only layout: what a setting means and how
// it is checked stay in settings.ts. A setting not named here still shows, under "Other", so a new one can never be hidden by forgetting to place it.
import { PLATFORM_SETTINGS, type SettingDef } from "./settings";

export type SettingGroup = { id: string; title: string; sub: string; keys: string[] };

export const SETTING_GROUPS: SettingGroup[] = [
  { id: "testing", title: "Testing and limits", sub: "The beta switch, message limits and trial rules", keys: ["otp_checks", "wa_daily_messages", "wa_daily_messages_other", "trial_max_vehicles", "pro_offer_min_job_cards"] },
  { id: "payments", title: "Payments and rates", sub: "Where customers pay, and the PKR rate", keys: ["bank_details", "payment_note", "pkr_per_usd", "fx_side", "fx_forexpk_consent"] },
  { id: "seller", title: "Seller and invoices", sub: "Who invoices are from", keys: ["company_details", "seller_legal_name", "seller_ntn", "seller_tax_reg", "seller_pseb_no"] },
  { id: "withholding", title: "Withholding tax", sub: "What a withholding customer keeps back, and the certificate", keys: ["wht_income_pct_default", "wht_sales_share_pct_default", "wht_certificate_section", "wht_income_base"] },
  { id: "contact", title: "Contact and chat", sub: "Email addresses and the live chat", keys: ["support_email", "billing_email", "sales_email", "chat_widget_code", "chat_widget_host"] },
  { id: "legal", title: "Legal", sub: "Address, registration and governing law shown in the terms", keys: ["legal_address", "legal_registration", "legal_jurisdiction"] },
];

/** The groups with their definitions filled in, in screen order. Settings placed in no group come last under "Other". */
export function groupedSettings(defs: SettingDef[] = PLATFORM_SETTINGS): (Omit<SettingGroup, "keys"> & { defs: SettingDef[] })[] {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const placed = new Set<string>();
  const out = SETTING_GROUPS.map((g) => {
    const found = g.keys.map((k) => byKey.get(k)).filter((d): d is SettingDef => !!d);
    for (const d of found) placed.add(d.key);
    return { id: g.id, title: g.title, sub: g.sub, defs: found };
  }).filter((g) => g.defs.length > 0);
  const rest = defs.filter((d) => !placed.has(d.key));
  if (rest.length) out.push({ id: "other", title: "Other", sub: "Settings not placed in a section", defs: rest });
  return out;
}
