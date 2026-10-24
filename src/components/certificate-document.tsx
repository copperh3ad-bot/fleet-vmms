import { CERTIFICATE_DISCLAIMER, type Certificate } from "@/lib/billing/certificates";
import { fmtMinor } from "@/lib/billing/tax";

const dmy = (s: string) => new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** The certificate as a page to print or save as PDF. Used by the customer's and the operator's screens. */
export function CertificateDocument({ c }: { c: Certificate }) {
  const total = Number(c.income_tax_minor) + Number(c.sales_tax_minor);
  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-8 text-zinc-900 print:border-0 print:p-0">
      {c.status === "void" && <p role="status" className="mb-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-800">VOID{c.void_reason ? `: ${c.void_reason}` : ""}. Do not use.</p>}
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div><h1 className="text-2xl font-semibold">Withholding tax certificate</h1>{c.section && <p className="mt-1 text-sm text-zinc-600">{c.section}</p>}</div>
        <div className="text-sm sm:text-right"><p className="font-mono text-lg">{c.number}</p><p className="text-zinc-600">Issued {dmy(c.issued_at)}</p></div>
      </header>

      <section className="mt-8 grid gap-6 text-sm sm:grid-cols-2" aria-label="Parties">
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Tax withheld by (withholding agent)</h2>
          <p className="mt-1 font-medium">{c.agent.legal_name ?? c.org_name}</p>
          <p className="text-zinc-700">NTN {c.agent.ntn ?? "—"}{c.agent.strn ? ` · STRN ${c.agent.strn}` : ""}</p>
          {c.agent.address && <p className="whitespace-pre-wrap text-zinc-700">{c.agent.address}</p>}
        </div>
        <div>
          <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Paid to (the supplier)</h2>
          <p className="mt-1 font-medium">{c.payee.legal_name ?? "—"}</p>
          <p className="text-zinc-700">NTN {c.payee.ntn ?? "—"}{c.payee.tax_reg ? ` · Sales tax reg. ${c.payee.tax_reg}` : ""}{c.payee.pseb_no ? ` · PSEB ${c.payee.pseb_no}` : ""}</p>
        </div>
      </section>

      <table className="mt-8 w-full text-left text-sm">
        <thead className="border-b border-zinc-300 text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="py-2">Particulars</th><th className="text-right">Amount</th></tr></thead>
        <tbody>
          <tr className="border-b border-zinc-100"><td className="py-2">Invoice {c.invoice_number}, dated {dmy(c.invoice_issued_at)}: amount the tax was worked out on</td><td className="py-2 text-right font-mono">{fmtMinor(c.gross_minor, c.currency)}</td></tr>
          <tr className="border-b border-zinc-100"><td className="py-2">Income tax withheld{c.income_tax_pct ? ` at ${Number(c.income_tax_pct)}%` : ""}</td><td className="py-2 text-right font-mono">{fmtMinor(c.income_tax_minor, c.currency)}</td></tr>
          <tr className="border-b border-zinc-100"><td className="py-2">Sales tax withheld</td><td className="py-2 text-right font-mono">{fmtMinor(c.sales_tax_minor, c.currency)}</td></tr>
          <tr><td className="py-3 font-semibold">Total tax withheld</td><td className="py-3 text-right font-mono font-semibold">{fmtMinor(total, c.currency)}</td></tr>
        </tbody>
      </table>

      <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-2">
        <div><dt className="text-zinc-500">Deposited with (challan or payment slip)</dt><dd className="mt-1">{c.deposit_reference ?? "Not stated"}</dd></div>
        <div><dt className="text-zinc-500">Date deposited</dt><dd className="mt-1">{c.deposit_date ? dmy(c.deposit_date) : "Not stated"}</dd></div>
      </dl>
      {c.note && <p className="mt-3 text-sm text-zinc-600">{c.note}</p>}

      <div className="mt-12 grid gap-8 text-sm sm:grid-cols-2" aria-label="Signature">
        <div className="border-t border-zinc-400 pt-1 text-zinc-600">Withholding agent: name, signature, stamp, date</div>
        <div className="border-t border-zinc-400 pt-1 text-zinc-600">Received for the supplier: name, date</div>
      </div>
      <p className="mt-8 text-xs text-zinc-500">{CERTIFICATE_DISCLAIMER}</p>
      <p className="mt-1 text-xs text-zinc-500">Issued by {c.issued_by_kind === "operator" ? "the supplier at the customer's request" : "the withholding agent"} through Fleet OTG.</p>
    </article>
  );
}
