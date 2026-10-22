// Usage: DATABASE_URL=... npx tsx scripts/send-reminders.mts
// Creates the "document expiring / expired" notifications that are due today, in every active workspace.
// Safe to run as often as you like: each reminder is claimed in the database first, so none is sent twice.
// Run it once a day from whatever scheduler the hosting provides. It is not a web endpoint.
import { pgDriver } from "../src/lib/db/pg-driver";
import { runDocumentReminders } from "../src/lib/compliance/reminders";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set"); process.exit(2); }
const driver = pgDriver(url);
try {
  const runs = await runDocumentReminders(driver);
  for (const r of runs) console.log(`${r.schema}: ${r.error ? "FAILED " + r.error : `${r.sent} reminder${r.sent === 1 ? "" : "s"}`}`);
  if (runs.some((r) => r.error)) process.exitCode = 1;
} finally { await driver.end(); }
