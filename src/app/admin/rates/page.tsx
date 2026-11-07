import { dmy } from "@/lib/format/date";
import { Suspense } from "react";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { listRates, MAX_STALE_DAYS } from "@/lib/billing/fx";
import { loadPlatformSettings } from "@/lib/billing/settings";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { fetchRateAction, saveRateAction } from "../actions";
import { MiniForm, ToggleButton } from "../forms";

export default function RatesPage() {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner /></Suspense>;
}


async function Inner() {
  const op = await requireOperator();
  const [rates, settings] = await Promise.all([listRates(getDriver(), op.id, 60), loadPlatformSettings(getDriver())]);
  const consent = (settings.fx_forexpk_consent ?? "").trim();
  const latest = rates[0];
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6 text-zinc-900">
      <PageHeader title="Exchange rates" sub="Dollars to rupees, for the day a customer paid" />

      <Panel title="Latest rate" action={latest ? <Pill tone="ok">{dmy(latest.rate_date)}</Pill> : <Pill tone="warn">None yet</Pill>}>
        {latest ? <p className="text-sm">Buying <span className="font-mono text-base">{Number(latest.buy)}</span> · selling <span className="font-mono text-base">{Number(latest.sell)}</span> · from {latest.source}.</p> : <p className="text-sm text-zinc-600">No rate has been stored. Invoices use the fallback rate in Settings{settings.pkr_per_usd ? ` (${settings.pkr_per_usd})` : ", which is not set, so no rupee invoice can be made"}.</p>}
        <p className="mt-3 text-xs text-zinc-600">An invoice uses the rate for the day the customer paid. A day with no rate uses the latest earlier one, up to {MAX_STALE_DAYS} days back; beyond that it uses the fallback rate in Settings and the invoice says so. Which side is used (buying, selling or average) is set in Settings.</p>
      </Panel>

      <Panel title="Enter a rate by hand" sub="Always available. It replaces an automatic rate for the same day.">
        <MiniForm action={saveRateAction} button="Save rate"
          fields={[{ name: "date", label: "Date", type: "date", width: "w-44" }, { name: "buy", label: "Buying", width: "w-28", placeholder: "276.75" }, { name: "sell", label: "Selling (optional)", width: "w-28", placeholder: "277.25" }, { name: "note", label: "Source or note", width: "w-64", placeholder: "Bank advice, SBP, ..." }]} />
      </Panel>

      <Panel title="Automatic rate from forex.pk" action={<Pill tone={consent ? "ok" : "neutral"}>{consent ? "On" : "Off"}</Pill>}>
        <div className="space-y-3 text-sm">
          <p>forex.pk&apos;s terms of use do not allow commercial use of its pages without its prior written consent, and it calls its rates indicative. So this stays <strong>off</strong> until you record, in Settings, who at forex.pk gave consent and when. Until then nothing is fetched, and you enter rates by hand.</p>
          {consent ? <p className="text-zinc-700">Consent on record: <span className="font-medium">{consent}</span>. The rate is fetched once a day (10:00 Pakistan time). It is stored under the date the page shows, never over a rate you entered by hand, and a jump of more than 10% is refused as a likely misreading.</p> : <p className="text-zinc-700">No consent is on record.</p>}
          {consent && <ToggleButton action={fetchRateAction} label="Fetch the rate now" />}
        </div>
      </Panel>

      <Panel title="Stored rates" flush>
        {rates.length === 0 ? <p className="p-5 text-sm text-zinc-500">Nothing yet.</p> : (
          <table className="w-full text-left text-sm">
            <thead className="text-[11px] uppercase tracking-wide text-zinc-500"><tr><th className="px-5 py-3">Date</th><th>Buying</th><th>Selling</th><th>Source</th><th className="px-5">Note</th></tr></thead>
            <tbody>{rates.map((r) => <tr key={r.rate_date} className="border-t border-zinc-100"><td className="px-5 py-2">{dmy(r.rate_date)}</td><td className="font-mono">{Number(r.buy)}</td><td className="font-mono">{Number(r.sell)}</td><td>{r.source}</td><td className="px-5 text-zinc-600">{r.note ?? ""}</td></tr>)}</tbody>
          </table>
        )}
      </Panel>
    </main>
  );
}
