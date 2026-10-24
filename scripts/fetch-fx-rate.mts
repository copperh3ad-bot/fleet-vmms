// Usage: DATABASE_URL=... npx tsx scripts/fetch-fx-rate.mts
// Fetches today's interbank USD/PKR rate from forex.pk and stores it under its own date. Does nothing, and says so, until the
// owner has recorded forex.pk's written consent in the operator Settings. Safe to run as often as you like.
import { pgDriver } from "../src/lib/db/pg-driver";
import { fetchInterbankRate } from "../src/lib/billing/fx";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
const driver = pgDriver(url);
try {
  const r = await fetchInterbankRate(driver, null);
  console.log(`rate ${r.date}: buying ${r.buy}, selling ${r.sell}${r.stored ? "" : " (kept the rate entered by hand)"}`);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
} finally { await driver.end(); }
