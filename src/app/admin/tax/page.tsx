import { dmy } from "@/lib/format/date";
import { Suspense } from "react";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listCertificatesOwed, listTaxRules } from "@/lib/billing/tax-data";
import { listScenarios } from "@/lib/billing/tax-scenarios";
import { listCertificates } from "@/lib/billing/certificates";
import { loadPlatformSettings } from "@/lib/billing/settings";
import { fmtMinor } from "@/lib/billing/tax";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { issueCertificateForCustomerAction, recordCertificateAction, saveScenarioAction, saveTaxRuleAction } from "../actions";
import { MiniForm } from "../forms";

export default function TaxPage() {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner /></Suspense>;
}

const MODE: Record<string, string> = { none: "No tax", authority: "Rate of the customer's authority", fixed: "One fixed rate" };

async function Inner() {
  const op = await requireOperator();
  const d = getDriver();
  const [rules, owed, settings, scenarios, certs] = await Promise.all([listTaxRules(d, op.id), listCertificatesOwed(d, op.id), loadPlatformSettings(d), listScenarios(d, op.id), listCertificates(d, op.id, 30)]);
  const fallbackRate = Number(settings.pkr_per_usd) > 0;
  const ready = !!settings.seller_tax_reg && rules.some((r) => r.active);
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6 text-zinc-900">
      <PageHeader title="Tax" sub="Which tax applies to which customers, the rates, and the withholding certificates" />

      <Panel title="Is Pakistani sales tax being charged?" action={<Pill tone={ready ? "ok" : "warn"}>{ready ? "Ready" : "Not yet"}</Pill>}>
        <ul className="space-y-1 text-sm">
          <li>{settings.seller_tax_reg ? "✓" : "✗"} Seller sales tax registration number is set (Settings).</li>
          <li>{rules.some((r) => r.active) ? "✓" : "✗"} At least one authority below is switched on.</li>
          <li>{fallbackRate ? "✓" : "–"} A fallback PKR-per-USD rate is set (Settings), for a day with no dated rate (Rates page).</li>
          <li>A Pakistani customer is charged sales tax only after it has also chosen its authority and given its registered name and NTN on its Billing page. Customers in other countries follow their scenario, below, and by default pay no tax.</li>
        </ul>
        <p className="mt-3 text-xs text-zinc-500">Rates and withholding percentages are yours to enter; this system has none built in. Confirm each with your tax adviser, and change it here when the law changes: invoices already issued keep the figures they were made with.</p>
      </Panel>

      <Panel title="Scenarios" sub="Which tax a customer gets, by country. The lowest priority number that matches the customer's country applies; one with no countries matches everyone, so give it the highest number.">
        <table className="mb-4 w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="py-2">Code</th><th>Name</th><th>Priority</th><th>Countries</th><th>Tax</th><th>Invoice in</th><th>State</th></tr></thead>
          <tbody>{scenarios.map((s) => (
            <tr key={s.code} className="border-t border-zinc-100 align-top">
              <td className="py-2 font-mono text-xs">{s.code}</td><td>{s.label}<span className="block text-xs text-zinc-500">{s.document_title}{s.withholding_allowed ? " · withholding allowed" : ""}</span></td><td>{s.priority}</td>
              <td className="max-w-40 break-words">{s.countries ? s.countries.join(", ") : "Everyone else"}</td>
              <td>{MODE[s.sales_tax_mode]}{s.sales_tax_mode === "fixed" ? ` ${Number(s.sales_tax_pct)}% ${s.tax_name ?? ""}` : ""}</td><td>{s.currency}</td><td><Pill tone={s.active ? "ok" : "neutral"}>{s.active ? "On" : "Off"}</Pill></td>
            </tr>))}</tbody>
        </table>
        <MiniForm action={saveScenarioAction} button="Save scenario"
          fields={[
            { name: "code", label: "Code", width: "w-32", placeholder: "AE_VAT" }, { name: "label", label: "Name", width: "w-56" }, { name: "priority", label: "Priority", width: "w-20", defaultValue: "50" },
            { name: "countries", label: "Countries (codes; empty = everyone)", width: "w-56", placeholder: "AE, SA" }, { name: "sales_tax_mode", label: "Tax type: none, authority or fixed", width: "w-40", defaultValue: "fixed" },
            { name: "sales_tax_pct", label: "Rate % (fixed)", width: "w-28" }, { name: "tax_name", label: "Tax name", width: "w-24", placeholder: "VAT" }, { name: "currency", label: "USD or PKR", width: "w-24", defaultValue: "USD" },
            { name: "withholding_allowed", label: "Withholding? (yes/no)", width: "w-32", defaultValue: "no" }, { name: "seller_registration", label: "Your registration here", width: "w-40" },
            { name: "document_title", label: "Invoice title", width: "w-40", defaultValue: "Tax invoice" }, { name: "note", label: "Note on the invoice", width: "w-72" }, { name: "active", label: "On? (yes/no)", width: "w-24", defaultValue: "yes" },
          ]} />
        <p className="mt-2 text-xs text-zinc-500">To change a scenario, save the same code again with the new values. Authority-based scenarios are in rupees and use the table below; fixed ones use the rate you give.</p>
      </Panel>

      <Panel title="Sales tax by authority" sub="For scenarios that use the customer's authority: one row for each, for example a province. The rate is the percent of the rupee price.">
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

      <Panel title="Withholding certificates to collect" sub="A customer that withholds pays that tax to the government for you and gives you a certificate. Until you hold it you cannot claim the credit. Record the one you received, or issue one for the customer." flush>
        {owed.length === 0 ? <p className="p-5 text-sm text-zinc-500">None owed.</p> : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {owed.map((o) => (
              <li key={o.invoice_id} className="space-y-3 px-5 py-4">
                <p><span className="font-medium">{o.org_name}</span> · {o.number} · issued {dmy(o.issued_at)}</p>
                <p className="text-zinc-600">Income tax withheld {fmtMinor(o.wht_income_minor, "PKR")}{Number(o.wht_sales_minor) > 0 ? `, sales tax withheld ${fmtMinor(o.wht_sales_minor, "PKR")}` : ""}</p>
                <div className="space-y-3">
                  <MiniForm action={recordCertificateAction.bind(null, o.invoice_id)} button="Record the certificate received"
                    fields={[{ name: "certificate_no", label: "Their certificate number", width: "w-56" }, { name: "received_on", label: "Received on", type: "date", width: "w-44" }]} />
                  <MiniForm action={issueCertificateForCustomerAction.bind(null, o.invoice_id)} button="Issue one for the customer"
                    fields={[{ name: "deposit_reference", label: "Challan number (if known)", width: "w-56" }, { name: "deposit_date", label: "Deposited on", type: "date", width: "w-44" }, { name: "note", label: "Note", width: "w-56" }]} />
                </div>
              </li>))}
          </ul>
        )}
      </Panel>

      <Panel title="Certificates issued through the application" flush>
        {certs.length === 0 ? <p className="p-5 text-sm text-zinc-500">None yet.</p> : (
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Number</th><th>Customer</th><th>Invoice</th><th className="text-right">Tax withheld</th><th>By</th><th className="px-5">State</th></tr></thead>
            <tbody>{certs.map((c) => (
              <tr key={c.id} className="border-t border-zinc-100">
                <td className="px-5 py-2"><a className="text-sky-800 underline" href={`/admin/certificates/${c.id}`}>{c.number}</a></td><td>{c.org_name}</td><td>{c.invoice_number}</td>
                <td className="text-right font-mono">{fmtMinor(Number(c.income_tax_minor) + Number(c.sales_tax_minor), c.currency)}</td><td>{c.issued_by_kind === "operator" ? "You" : "Customer"}</td>
                <td className="px-5"><Pill tone={c.status === "issued" ? "ok" : "bad"}>{c.status === "issued" ? "Issued" : "Void"}</Pill></td>
              </tr>))}</tbody>
          </table>
        )}
      </Panel>
    </main>
  );
}
