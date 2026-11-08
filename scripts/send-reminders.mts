// Usage: DATABASE_URL=... npx tsx scripts/send-reminders.mts
// Creates the "document expiring / expired" notifications that are due today, in every active workspace.
// Safe to run as often as you like: each reminder is claimed in the database first, so none is sent twice.
// Run it once a day from whatever scheduler the hosting provides. It is not a web endpoint.
import { pgDriver } from "../src/lib/db/pg-driver";
import { routingDriver } from "../src/lib/db/router";
import { envSecretBox } from "../src/lib/crypto/secretbox";
import { runDocumentReminders } from "../src/lib/compliance/reminders";
import { runBillingReminders } from "../src/lib/billing/reminders";
import { applyDueSwitches } from "../src/lib/billing/plan-switch";
import { purgeActivityLog, timedJob } from "../src/lib/activity/core";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
// Through the router, so organizations with their own database (ADR-014) are included. ORG_DB_KEY is needed only if there are any.
const driver = routingDriver({ control: pgDriver(url), makeDriver: (u) => pgDriver(u, { max: 1 }), decrypt: (b) => envSecretBox().decrypt(b) });
try {
  const sw = await timedJob(driver, "plan switches", () => applyDueSwitches(driver), (r) => ({ ...r }));
  if (sw.switched || sw.trialsClosed) console.log(`plans: switched ${sw.switched}, Pro trials closed ${sw.trialsClosed}`);
  const runs = await timedJob(driver, "document reminders", () => runDocumentReminders(driver), (r) => ({ workspaces: r.length, sent: r.reduce((n, x) => n + x.sent, 0), failed: r.filter((x) => x.error).map((x) => `${x.schema}: ${x.error}`).slice(0, 5) }));
  for (const r of runs) console.log(`${r.schema}: ${r.error ? "FAILED " + r.error : `${r.sent} reminder${r.sent === 1 ? "" : "s"}${r.emailed ? `, ${r.emailed} email${r.emailed === 1 ? "" : "s"}` : ""}`}`);
  const billing = await timedJob(driver, "billing reminders", () => runBillingReminders(driver), (r) => ({ workspaces: r.length, sent: r.reduce((n, x) => n + (typeof x.sent === "number" ? x.sent : 0), 0), failed: r.filter((x) => x.error).map((x) => `${x.schema}: ${x.error}`).slice(0, 5) }));
  await timedJob(driver, "activity log purge", () => purgeActivityLog(driver), (n) => ({ removed: n }));
  for (const r of billing) console.log(`${r.schema}: billing ${r.error ? "FAILED " + r.error : r.sent}`);
  if (runs.some((r) => r.error) || billing.some((r) => r.error)) process.exitCode = 1;
} finally { await driver.end(); }
