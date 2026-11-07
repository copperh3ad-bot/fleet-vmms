// The monthly odometer request on WhatsApp (ADR-050). A scheduled function has no web address and cannot be called from outside, so this adds no public endpoint
// (CLAUDE.md rule 5). 04:00 UTC is 09:00 in Pakistan. Safe to run more than once a day: a holder is asked once, reminded once, and nothing is sent when the feature is off.
import type { Config } from "@netlify/functions";
import { pgDriver } from "../../src/lib/db/pg-driver";
import { routingDriver } from "../../src/lib/db/router";
import { envSecretBox } from "../../src/lib/crypto/secretbox";
import { runOdometerWhatsApp } from "../../src/lib/odometer/whatsapp";

const run = async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  const driver = routingDriver({ control: pgDriver(url), makeDriver: (u) => pgDriver(u, { max: 1 }), decrypt: (b) => envSecretBox().decrypt(b) });
  try {
    const runs = await runOdometerWhatsApp(driver);
    for (const r of runs) console.log(`${r.schema}: odometer whatsapp ${r.error ? "FAILED " + r.error : `${r.opened ? "opened the month, " : ""}${r.sent} asked, ${r.reminded} reminded, ${r.failed} not sent`}`);
    if (runs.some((r) => r.error)) throw new Error("Some workspaces failed, see the lines above.");
  } finally { await driver.end(); }
};

export default run;

export const config: Config = { schedule: "0 4 * * *" };
