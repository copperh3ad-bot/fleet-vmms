import { Suspense } from "react";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listCertificatesOwed, listTaxRules } from "@/lib/billing/tax-data";
import { loadPlatformSettings } from "@/lib/billing/settings";
import { rupees } from "@/lib/billing/tax";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { recordCertificateAction, saveTaxRuleAction } from "../actions";
import { MiniForm } from "../forms";

export default function TaxPage() {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner /></Suspense>;
}

const dmy = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

async function Inner() {
  const op = await requireOperator();
  const driver = getDriver();
  const [rules, owed, settings] = await Promise.all([listTaxRules(driver, op.id), listCertificatesOwed(driver, op.id), loadPlatformSettings(driver)]);
  const ready = !!settings.seller_tax_reg && Number(settings.pkr_per_usd) > 0;
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6 text-zinc-900">
      <PageHeader title="Tax" sub="Rates, and the withholding certificates customers owe you" />

      <Panel title="Is tax being charged?" action={<Pill tone={ready && rules.some((r) => r.active) ? "ok" : "warn"}>{ready && rules.some((r) => r.active) ? "Ready" : "Not yet"}</Pill>}>
        <ul className="space-y-1 text-sm">
          <li>{settings.seller_tax_reg ? "✓" : "✗"} Seller sales tax registration number is set (Settings).</li>
          <li>{Number(settings.pkr_per_usd) > 0 ? "✓" : "✗"} PKR per USD is set (Settings).</li>
          <li>{rules.some((r) => r.active) ? "✓" : "✗"} At least one authority below is switched on.</li>
          <li>A customer is charged sales tax only after it has also chosen its authority and given its registered name and NTN on its Billing page.</li>
        </ul>
        <p className="mt-3 text-xs text-zinc-500">Rates and withholding percentages are yours to enter; this system has none built in. Confirm each with your tax adviser, and change it here when the law changes: invoices already issued keep the figures they were made with.</p>
      </Panel>

      <Panel title="Sales tax by authority" sub="One row for each authority your customers fall under, for example a province. The rate is the percent of the rupee price.">
        {rules.length > 0 && (
          <table className="mb-4 w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="py-2">Code</th><th>Name</th><th>Rate</th><th>State</th></tr></thead>
            <tbody>{rules.map((r) => <tr key={r.code} className="border-t border-zinc-100"><td className="py-2 font-mono">{r.code}</td><td>{r.label}</td><td>{Number(r.sales_tax_pct)}%</td><td><Pill tone={r.active ? "ok" : "neutral"}>{r.active ? "On" : "Off"}</Pill></td></tr>)}</tbody>
          </table>
        )}
        <MiniForm action={saveTaxRuleAction} button="Save authority"
          fields={[{ name: "code", label: "Code", width: "w-28", placeholder: "PRA" }, { name: "label", label: "Name", width: "w-64", placeholder: "Punjab" }, { name: "sales_tax_pct", label: "Rate (%)", width: "w-24" }, { name: "active", label: "On? (yes or no)", width: "w-24", defaultValue: "yes" }]} />
        <p className="mt-2 text-xs text-zinc-500">To change a rate or switch one off, save the same code again.</p>
      </Panel>

      <Panel title="Withholding certificates to collect" sub="A customer that withholds pays that tax to the government for you and gives you a certificate. Until you hold it you cannot claim the credit." flush>
        {owed.length === 0 ? <p className="p-5 text-sm text-zinc-500">None owed.</p> : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {owed.map((o) => (
              <li key={o.invoice_id} className="space-y-3 px-5 py-4">
                <p><span className="font-medium">{o.org_name}</span> · {o.number} · issued {dmy(o.issued_at)}</p>
                <p className="text-zinc-600">Income tax withheld {rupees(o.wht_income_minor)}{Number(o.wht_sales_minor) > 0 ? `, sales tax withheld ${rupees(o.wht_sales_minor)}` : ""}</p>
                <MiniForm action={recordCertificateAction.bind(null, o.invoice_id)} button="Record certificate"
                  fields={[{ name: "certificate_no", label: "Certificate number", width: "w-56" }, { name: "received_on", label: "Received on", type: "date", width: "w-44" }]} />
              </li>))}
          </ul>
        )}
      </Panel>
    </main>
  );
}
