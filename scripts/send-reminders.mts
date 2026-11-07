// Usage: DATABASE_URL=... npx tsx scripts/send-reminders.mts
// Creates the "document expiring / expired" notifications that are due today, in every active workspace.
// Safe to run as often as you like: each reminder is claimed in the database first, so none is sent twice.
// Run it once a day from whatever scheduler the hosting provides. It is not a web endpoint.
import { pgDriver } from "../src/lib/db/pg-driver";
import { routingDriver } from "../src/lib/db/router";
import { envSecretBox } from "../src/lib/crypto/secretbox";
import { runDocumentReminders } from "../src/lib/compliance/reminders";
import { runBillingReminders } from "../src/lib/billing/reminders";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
// Through the router, so organizations with their own database (ADR-014) are included. ORG_DB_KEY is needed only if there are any.
const driver = routingDriver({ control: pgDriver(url), makeDriver: (u) => pgDriver(u, { max: 1 }), decrypt: (b) => envSecretBox().decrypt(b) });
try {
  const runs = await runDocumentReminders(driver);
  for (const r of runs) console.log(`${r.schema}: ${r.error ? "FAILED " + r.error : `${r.sent} reminder${r.sent === 1 ? "" : "s"}${r.emailed ? `, ${r.emailed} email${r.emailed === 1 ? "" : "s"}` : ""}`}`);
  const billing = await runBillingReminders(driver);
  for (const r of billing) console.log(`${r.schema}: billing ${r.error ? "FAILED " + r.error : r.sent}`);
  if (runs.some((r) => r.error) || billing.some((r) => r.error)) process.exitCode = 1;
} finally { await driver.end(); }
