import { envSecretBox } from "@/lib/crypto/secretbox";
import { pgDriver } from "./pg-driver";
import { routingDriver, type RoutingDriver } from "./router";
import type { Driver } from "./types";

let driver: RoutingDriver | undefined;

/**
 * The one database entry for server code. It routes each transaction: work for an organization goes to that
 * organization's own database (ADR-014), everything else to the control database (DATABASE_URL).
 */
export function getDriver(): Driver {
  if (!driver) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
    driver = routingDriver({
      control: pgDriver(url),
      makeDriver: (u) => pgDriver(u, { max: 2 }),
      decrypt: (boxed) => envSecretBox().decrypt(boxed),   // only needed once an organization has its own database
    });
  }
  return driver;
}
