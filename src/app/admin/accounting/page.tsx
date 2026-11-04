/* eslint-disable @next/next/no-html-link-for-pages -- the two export links are file downloads served by a route handler, not pages */
import { Suspense } from "react";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listAccounts, listJournals, ROLE_LABEL, taxSummary, trialBalance } from "@/lib/billing/accounting";
import { fmtMinor } from "@/lib/billing/tax";
import { btn, PageHeader, Panel, Pill } from "@/components/ui";
import { backfillLedgerAction, reverseJournalAction, saveAccountAction } from "../actions";
import { MiniForm, ToggleButton } from "../forms";
import { ManualEntryForm } from "./forms";

export default function AccountingPage() {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner /></Suspense>;
}

const dmy = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

async function Inner() {
  const op = await requireOperator();
  const d = getDriver();
  const [accounts, trial, tax, journals] = await Promise.all([listAccounts(d, op.id), trialBalance(d, op.id), taxSummary(d, op.id), listJournals(d, op.id, { limit: 25 })]);
  const currencies = [...new Set(trial.map((r) => r.currency))];
  return (
    <main className="mx-auto max-w-5xl 2xl:max-w-6xl space-y-5 p-6 text-zinc-900">
      <PageHeader title="Accounting" sub="The ledger of the subscription business: posted from every invoice, never edited"
        actions={<><a className={btn} href="/admin/accounting/export/journal">Journal (CSV)</a><a className={btn} href="/admin/accounting/export/tax-summary">Tax summary (CSV)</a></>} />

      <Panel title="Trial balance" sub="Each currency balances on its own. Debits less credits.">
        {trial.length === 0 ? <p className="text-sm text-zinc-500">No entries yet.</p> : currencies.map((c) => {
          const rows = trial.filter((r) => r.currency === c);
          const total = rows.reduce((s, r) => s + Number(r.balance_minor), 0);
          return (
            <div key={c} className="mb-4 last:mb-0">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">{c}</p>
              <table className="w-full text-left text-sm">
                <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="py-1">Account</th><th className="text-right">Debits</th><th className="text-right">Credits</th><th className="text-right">Balance</th></tr></thead>
                <tbody>{rows.map((r) => <tr key={r.account_code} className="border-t border-zinc-100"><td className="py-1.5"><span className="font-mono text-xs text-zinc-500">{r.account_code}</span> {r.account_name}</td><td className="text-right font-mono">{fmtMinor(r.debit_minor, c)}</td><td className="text-right font-mono">{fmtMinor(r.credit_minor, c)}</td><td className="text-right font-mono">{fmtMinor(r.balance_minor, c)}</td></tr>)}</tbody>
                <tfoot><tr className="border-t border-zinc-300 font-medium"><td className="py-1.5">Check: must be zero</td><td /><td /><td className="text-right font-mono">{total === 0 ? <Pill tone="ok">0</Pill> : <Pill tone="bad">{fmtMinor(total, c)}</Pill>}</td></tr></tfoot>
              </table>
            </div>
          );
        })}
      </Panel>

      <Panel title="Tax by month" sub="What was charged and withheld, from the invoices. This is what a return is prepared from." flush>
        {tax.length === 0 ? <p className="p-5 text-sm text-zinc-500">No invoices yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Month</th><th>Scenario</th><th className="text-right">Invoices</th><th className="text-right">Subtotal</th><th className="text-right">Sales tax</th><th className="text-right">Income tax withheld</th><th className="text-right">Sales tax withheld</th><th className="px-5 text-right">Certificates held / missing</th></tr></thead>
            <tbody>{tax.map((r) => (
              <tr key={`${r.month}${r.currency}${r.scenario}`} className="border-t border-zinc-100">
                <td className="px-5 py-2">{r.month}</td><td>{r.scenario} <span className="text-xs text-zinc-500">{r.currency}</span></td><td className="text-right">{r.invoices}</td>
                <td className="text-right font-mono">{fmtMinor(r.subtotal_minor, r.currency)}</td><td className="text-right font-mono">{fmtMinor(r.sales_tax_minor, r.currency)}</td>
                <td className="text-right font-mono">{fmtMinor(r.wht_income_minor, r.currency)}</td><td className="text-right font-mono">{fmtMinor(r.wht_sales_minor, r.currency)}</td>
                <td className="px-5 text-right">{r.certificates_held} / {r.certificates_missing > 0 ? <span className="font-medium text-red-800">{r.certificates_missing}</span> : 0}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </Panel>

      <Panel title="Recent entries" sub="The newest 25. The full list is in the CSV." flush>
        {journals.length === 0 ? <p className="p-5 text-sm text-zinc-500">None yet.</p> : (
          <ul className="divide-y divide-zinc-100 text-sm">
            {journals.map((j) => (
              <li key={j.id} className="space-y-2 px-5 py-3">
                <p className="flex flex-wrap items-center gap-2"><span className="font-mono">{j.number}</span><span className="text-zinc-500">{dmy(j.posted_at)} · {j.currency}</span>{j.source_kind !== "invoice" && <Pill tone="info">{j.source_kind}</Pill>}{j.reversed && <Pill tone="neutral">reversed</Pill>}<span className="text-zinc-700">{j.memo}</span></p>
                <table className="w-full max-w-xl text-xs"><tbody>{j.lines.map((l, i) => <tr key={i}><td className="py-0.5 font-mono text-zinc-500">{l.account_code}</td><td>{l.account_name}</td><td className="text-right font-mono">{Number(l.debit_minor) ? fmtMinor(l.debit_minor, j.currency) : ""}</td><td className="text-right font-mono">{Number(l.credit_minor) ? fmtMinor(l.credit_minor, j.currency) : ""}</td></tr>)}</tbody></table>
                {j.source_kind !== "reversal" && !j.reversed && <MiniForm action={reverseJournalAction.bind(null, j.id)} button="Reverse" fields={[{ name: "memo", label: "Why", width: "w-72" }]} />}
              </li>))}
          </ul>
        )}
      </Panel>

      <Panel title="Enter an adjustment" sub="Up to four lines; debits must equal credits. Use it for bank charges, corrections and anything not from an invoice.">
        <ManualEntryForm accounts={accounts.filter((a) => a.active).map((a) => ({ code: a.code, name: a.name }))} />
      </Panel>

      <Panel title="Chart of accounts" sub="Rename, add or renumber freely. Posting follows the role (the bank, revenue and so on), so an account can change number without breaking anything.">
        <table className="mb-4 w-full text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="py-1">Code</th><th>Name</th><th>Kind</th><th>Role</th><th>State</th></tr></thead>
          <tbody>{accounts.map((a) => <tr key={a.code} className="border-t border-zinc-100"><td className="py-1.5 font-mono">{a.code}</td><td>{a.name}</td><td>{a.kind}</td><td>{a.system_key ? ROLE_LABEL[a.system_key] : "—"}</td><td><Pill tone={a.active ? "ok" : "neutral"}>{a.active ? "On" : "Off"}</Pill></td></tr>)}</tbody>
        </table>
        <MiniForm action={saveAccountAction} button="Save account" fields={[{ name: "code", label: "Code", width: "w-24" }, { name: "name", label: "Name", width: "w-64" }, { name: "kind", label: "asset, liability, income, expense, equity", width: "w-40", defaultValue: "asset" }, { name: "role", label: "Role (optional)", width: "w-40", placeholder: "BANK, REVENUE, ..." }, { name: "active", label: "On? (yes/no)", width: "w-24", defaultValue: "yes" }]} />
        <p className="mt-2 text-xs text-zinc-500">Roles: BANK, REVENUE, SALES_TAX, WHT_INCOME, WHT_SALES, DIFFERENCE. To save an existing code again with changes, enter the same code.</p>
      </Panel>

      <Panel title="Older invoices" sub="Posts any invoice that has no entry yet, for example one made before the ledger existed. Safe to repeat.">
        <ToggleButton action={backfillLedgerAction} label="Post missing invoices" />
      </Panel>
    </main>
  );
}
