import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { getOrganization } from "@/lib/billing/operator";
import { getOrgTax } from "@/lib/billing/tax-data";
import { formatPrice } from "@/lib/billing/offer";
import { paymentReference } from "@/lib/billing/payments";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { deleteOrganizationAction, extendTrialAction, manualPaymentAction, setCompedAction, setOrgWithholdingAction, setSuspendedAction } from "../../actions";
import { MiniForm, ToggleButton } from "../../forms";

export default function OrgPage({ params }: PageProps<"/admin/orgs/[id]">) {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner params={params} /></Suspense>;
}

const dmy = (s: string | null) => (s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

async function Inner({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const op = await requireOperator();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const o = await getOrganization(getDriver(), op.id, id);
  if (!o) notFound();
  const b = o.billing;
  const tax = await getOrgTax(getDriver(), op.id, id);
  const closed = o.status === "closed";
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6 text-zinc-900">
      <PageHeader crumb={<><a className="underline" href="/admin">Organizations</a> / {o.slug}</>} title={o.name} sub={`${o.db_kind === "dedicated" ? "Own database" : "Shared database"} · created ${dmy(o.created_at)}`} />
      <Panel title="Status" action={<Pill tone={o.access.full ? "ok" : "bad"}>{o.access.state}</Pill>}>
        <dl className="grid gap-4 text-sm sm:grid-cols-3">
          <div><dt className="text-zinc-500">Billing</dt><dd className="mt-1">{b ? `${b.status}${b.comped ? " (no charge)" : ""}${b.suspended ? ", locked by you" : ""}` : "none"}</dd></div>
          <div><dt className="text-zinc-500">Trial ends</dt><dd className="mt-1">{dmy(b?.trial_ends_at ?? null)}</dd></div>
          <div><dt className="text-zinc-500">Paid until</dt><dd className="mt-1">{dmy(b?.current_period_end ?? null)}</dd></div>
          <div><dt className="text-zinc-500">Price</dt><dd className="mt-1">{b ? `${formatPrice(b.price_cents, b.currency)} a month` : "—"}</dd></div>
          <div><dt className="text-zinc-500">Payment reference</dt><dd className="mt-1 font-mono">{paymentReference(o.id)}</dd></div>
          <div><dt className="text-zinc-500">People</dt><dd className="mt-1">{o.members}</dd></div>
        </dl>
        {o.provision_state !== "ready" && <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Set-up state: {o.provision_state.replace("_", " ")}{o.provision_error ? `. Last error: ${o.provision_error}` : ""}</p>}
      </Panel>

      <Panel title="Tax details" sub="What this customer told us for its tax invoices">
        {!tax ? <p className="text-sm text-zinc-500">Not given yet. No sales tax is charged until the customer fills this in on its Billing page.</p> : (
          <div className="space-y-4">
            <dl className="grid gap-4 text-sm sm:grid-cols-3">
              <div><dt className="text-zinc-500">Registered name</dt><dd className="mt-1">{tax.legal_name ?? "—"}</dd></div>
              <div><dt className="text-zinc-500">NTN / STRN</dt><dd className="mt-1 font-mono">{tax.ntn ?? "—"} / {tax.strn ?? "—"}</dd></div>
              <div><dt className="text-zinc-500">Authority</dt><dd className="mt-1">{tax.authority ? `${tax.authority} (${Number(tax.sales_tax_pct)}%)` : "None chosen"}</dd></div>
              <div><dt className="text-zinc-500">Withholds tax</dt><dd className="mt-1">{tax.withholding_agent ? "Yes" : "No"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-zinc-500">Address</dt><dd className="mt-1 whitespace-pre-wrap">{tax.address ?? "—"}</dd></div>
            </dl>
            {tax.withholding_agent && (
              <div>
                <p className="mb-2 text-sm font-medium">What this customer keeps back (empty uses the default in Settings)</p>
                <MiniForm action={setOrgWithholdingAction.bind(null, o.id)} button="Save"
                  fields={[{ name: "income_pct", label: "Income tax %", width: "w-28", defaultValue: tax.wht_income_pct ?? "" }, { name: "sales_share_pct", label: "Share of sales tax %", width: "w-32", defaultValue: tax.wht_sales_share_pct ?? "" }]} />
              </div>
            )}
          </div>
        )}
      </Panel>

      {!closed && b && (
        <Panel title="Actions">
          <div className="space-y-5">
            <div className="flex flex-wrap gap-3">
              <ToggleButton action={setSuspendedAction.bind(null, o.id, !b.suspended)} label={b.suspended ? "Unlock this organization" : "Lock this organization"} />
              <ToggleButton action={setCompedAction.bind(null, o.id, !b.comped)} label={b.comped ? "Start billing it again" : "Waive billing (no charge)"} />
            </div>
            {b.status === "trialing" && <MiniForm action={extendTrialAction.bind(null, o.id)} fields={[{ name: "days", label: "Extra trial days", type: "number", defaultValue: "3", width: "w-28" }]} button="Extend the trial" />}
            <div>
              <p className="mb-2 text-sm font-medium">Record a payment received another way</p>
              <MiniForm action={manualPaymentAction.bind(null, o.id)} fields={[{ name: "months", label: "Months", type: "number", defaultValue: "1", width: "w-24" }, { name: "note", label: "How it was paid", width: "w-72", placeholder: "Cash at the office, receipt 55" }]} button="Record payment and issue invoice" />
            </div>
          </div>
        </Panel>
      )}

      {!closed && o.db_kind === "dedicated" && (
        <Panel title="Delete this organization&apos;s database" sub="Permanent. Only possible while the organization has no access. Invoices and payment records stay.">
          <MiniForm action={deleteOrganizationAction.bind(null, o.id)} fields={[{ name: "typed", label: `Type: DELETE ${o.slug}`, width: "w-72" }]} button="Delete the database for good" danger />
        </Panel>
      )}
      {closed && <p className="rounded-md border border-zinc-200 bg-white p-4 text-sm text-zinc-600">This organization has been deleted.</p>}
    </main>
  );
}
