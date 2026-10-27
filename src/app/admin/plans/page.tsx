import { Suspense } from "react";
import { requireOperator } from "@/lib/auth/session";
import { getDriver } from "@/lib/db";
import { bandsCoverEverySize, listBands, listPlans } from "@/lib/billing/plans";
import { formatPrice } from "@/lib/billing/offer";
import { PageHeader, Panel, Pill } from "@/components/ui";
import { setPlanPriceAction, setProBandsAction } from "../actions";
import { MiniForm } from "../forms";

export default function PlansPage() {
  return <Suspense fallback={<p className="p-6 text-sm text-zinc-500">Loading</p>}><Inner /></Suspense>;
}

const ROWS = 5;

// The owner's own page for Basic and Pro (ADR-035, CLAUDE.md rule 7): every price is entered here and lives in the database, never in the code.
async function Inner() {
  await requireOperator();
  const [plans, bands] = await Promise.all([listPlans(getDriver()), listBands(getDriver())]);
  const basic = plans.find((p) => p.key === "standard");
  const pro = plans.find((p) => p.key === "pro");
  const onSale = bandsCoverEverySize(bands);
  const fields = Array.from({ length: ROWS }, (_, i) => [
    { name: `up_to_${i}`, label: i === 0 ? "Up to this many vehicles" : "…up to", width: "w-40", defaultValue: bands[i] ? (bands[i].up_to_vehicles === null ? "" : String(bands[i].up_to_vehicles)) : "", placeholder: i === ROWS - 1 || (bands[i] && bands[i].up_to_vehicles === null) ? "empty = no limit" : "" },
    { name: `price_${i}`, label: i === 0 ? "Price per month" : "Price", width: "w-32", defaultValue: bands[i] ? String(bands[i].price_cents / 100) : "" },
    { name: `reads_${i}`, label: i === 0 ? "AI readings per day" : "Readings", width: "w-28", defaultValue: bands[i] ? String(bands[i].ai_reads_per_day) : "" },
  ]).flat();
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6 text-zinc-900">
      <PageHeader title="Plans" sub="Basic and Pro: what each costs, set by you" />

      <Panel title="Basic (the original plan)" action={<Pill tone="ok">{basic?.price_cents != null ? `${formatPrice(basic.price_cents, basic.currency)} a month` : "No price"}</Pill>}>
        <div className="space-y-3 text-sm">
          <p className="text-zinc-700">Every feature, no AI. The plan every current customer is on. Changing its price changes it for organizations that join from now on; organizations already paying keep the price they joined at.</p>
          <MiniForm action={setPlanPriceAction.bind(null, "standard")} button="Save price" fields={[
            { name: "price", label: "Price per month", width: "w-40", defaultValue: basic?.price_cents == null ? "" : String(basic.price_cents / 100) },
            { name: "currency", label: "Currency", width: "w-24", defaultValue: basic?.currency ?? "USD" },
            { name: "trial_days", label: "Free trial days", width: "w-28", defaultValue: String(basic?.trial_days ?? 0) },
          ]} />
        </div>
      </Panel>

      <Panel title="Pro (Basic plus AI)" action={<Pill tone={onSale ? "ok" : "warn"}>{onSale ? "For sale" : "Not for sale yet"}</Pill>}>
        <div className="space-y-3 text-sm">
          <p className="text-zinc-700">Pro is priced by the size of the fleet, because a larger fleet sends more estimates and invoices for the AI to read. Fill in bands from the smallest fleet up; <strong>the last band must have no upper limit</strong> so every fleet has a price. Leave every row empty to take Pro off sale. Until the bands cover every size, Pro is announced on the Pricing page but cannot be bought. You can still try Pro yourself: waive billing on your own organization and move it to Pro from its page.</p>
          <p className="text-zinc-700">An organization&apos;s band is worked out from its number of vehicles when it joins Pro or renews, and it keeps that price and daily allowance until then. A band&apos;s &ldquo;readings per day&rdquo; is the most documents the AI will read for that organization in a day.</p>
          <MiniForm action={setProBandsAction} button="Save Pro bands" fields={[...fields, { name: "currency", label: "Currency", width: "w-24", defaultValue: bands[0]?.currency ?? pro?.currency ?? "USD" }]} />
        </div>
      </Panel>
    </main>
  );
}
