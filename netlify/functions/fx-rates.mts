// Daily dollar-to-rupee rate on Netlify (ADR-018). Same job as `npm run fx-rates`. It does nothing unless the owner has recorded
// written consent from forex.pk in Settings. A scheduled function has no web address, so this adds no public endpoint (rule 5).
// 05:00 UTC is 10:00 in Pakistan, after the interbank rate for the day is out; it is safe to run more than once.
import type { Config } from "@netlify/functions";
import { pgDriver } from "../../src/lib/db/pg-driver";
import { fetchInterbankRate } from "../../src/lib/billing/fx";

const fetchRate = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const driver = pgDriver(url);
  try {
    const r = await fetchInterbankRate(driver, null);
    console.log(`rate ${r.date}: buying ${r.buy}, selling ${r.sell}${r.stored ? "" : " (kept the rate entered by hand)"}`);
  } catch (e) {
    console.log(e instanceof Error ? e.message : String(e));        // off, or the page changed: reported, never thrown at a customer
  } finally { await driver.end(); }
};

export default fetchRate;

export const config: Config = { schedule: "0 5 * * *" };
