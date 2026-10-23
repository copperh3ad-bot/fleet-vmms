// Daily document-expiry reminders on Netlify. Same job as `npm run reminders` (scripts/send-reminders.mts).
// A scheduled function has no web address and cannot be called from outside, so this adds no public endpoint
// (CLAUDE.md rule 5). 03:00 UTC is 08:00 in Pakistan; the job is safe to run more than once a day.
import type { Config } from "@netlify/functions";
import { pgDriver } from "../../src/lib/db/pg-driver";
import { routingDriver } from "../../src/lib/db/router";
import { envSecretBox } from "../../src/lib/crypto/secretbox";
import { runDocumentReminders } from "../../src/lib/compliance/reminders";
import { runBillingReminders } from "../../src/lib/billing/reminders";

const sendReminders = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  // Through the router, so organizations with their own database (ADR-014) get their reminders too.
  const driver = routingDriver({ control: pgDriver(url), makeDriver: (u) => pgDriver(u, { max: 1 }), decrypt: (b) => envSecretBox().decrypt(b) });
  try {
    const runs = await runDocumentReminders(driver);
    for (const r of runs) console.log(`${r.schema}: ${r.error ? "FAILED " + r.error : `${r.sent} reminder${r.sent === 1 ? "" : "s"}`}`);
    const billing = await runBillingReminders(driver);
    for (const r of billing) console.log(`${r.schema}: billing ${r.error ? "FAILED " + r.error : r.sent}`);
    if (runs.some((r) => r.error) || billing.some((r) => r.error)) throw new Error("Some workspaces failed, see the lines above.");
  } finally { await driver.end(); }
};

export default sendReminders;

export const config: Config = { schedule: "0 3 * * *" };
