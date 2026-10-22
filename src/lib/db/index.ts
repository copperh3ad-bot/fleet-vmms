import { pgDriver } from "./pg-driver";
import type { Driver } from "./types";

let driver: (Driver & { end(): Promise<void> }) | undefined;

/** The one shared pool for server code. Throws a clear error if the connection string is missing. */
export function getDriver(): Driver {
  if (!driver) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
    driver = pgDriver(url);
  }
  return driver;
}
