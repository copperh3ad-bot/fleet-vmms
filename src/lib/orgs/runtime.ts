// What the running site needs to create an organization: the control database, the database provider, the key for stored
// connection strings, and the migrations (embedded in the build, since there is no disk to read them from).
import { envSecretBox } from "@/lib/crypto/secretbox";
import { getDriver } from "@/lib/db";
import { PLATFORM_MIGRATIONS, TENANT_MIGRATIONS } from "@/lib/db/embedded-migrations";
import { pgDriver } from "@/lib/db/pg-driver";
import { providerFromEnv } from "./db-provider";
import type { ProvisionDeps } from "./provision";

/** Throws a clear message if a setting is missing, so the sign-up page can say "not available yet" instead of failing halfway. */
export function provisionDeps(): ProvisionDeps {
  return {
    control: getDriver(),                       // the router: with no schema it goes to the control database
    provider: providerFromEnv(),
    openDb: (url) => pgDriver(url, { max: 1 }),
    box: envSecretBox(),
    platformMigrations: PLATFORM_MIGRATIONS,
    tenantMigrations: TENANT_MIGRATIONS,
    connectRetries: { tries: 4, delayMs: 1500 },
  };
}

/** True when this deployment can create organizations (the provider and the key are configured). */
export function signupsOpen(): boolean {
  try { provisionDeps(); return true; } catch { return false; }
}
