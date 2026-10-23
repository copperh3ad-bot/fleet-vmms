// What the running site needs to create an organization (ADR-014, as amended). By default each organization is a separate
// schema inside the control database ("shared"), which needs nothing beyond DATABASE_URL. With ORG_DB_MODE=dedicated each
// one gets its own database from a provider (Neon), which also needs the provider's key and ORG_DB_KEY. The migrations are
// embedded in the build, since there is no disk to read them from.
import { envSecretBox } from "@/lib/crypto/secretbox";
import { getDriver } from "@/lib/db";
import { PLATFORM_MIGRATIONS, TENANT_MIGRATIONS } from "@/lib/db/embedded-migrations";
import { pgDriver } from "@/lib/db/pg-driver";
import { providerFromEnv, type DbProvider } from "./db-provider";
import type { OrgKind, ProvisionDeps } from "./provision";

/** Which kind of organization new sign-ups get. */
export const orgMode = (): OrgKind => (process.env.ORG_DB_MODE === "dedicated" ? "dedicated" : "shared");

const unavailable = (what: string) => () => { throw new Error(`${what} is only available when ORG_DB_MODE=dedicated.`); };
const noProvider: DbProvider = { name: "none", create: unavailable("A database provider") as DbProvider["create"], destroy: unavailable("A database provider") as DbProvider["destroy"] };

/** Throws a clear message if a setting is missing, so the sign-up page can say "not available yet" instead of failing halfway. */
export function provisionDeps(): ProvisionDeps {
  const dedicated = orgMode() === "dedicated";
  return {
    control: getDriver(),                       // the router: with no schema it goes to the control database
    provider: dedicated ? providerFromEnv() : noProvider,
    openDb: (url) => pgDriver(url, { max: 1 }),
    box: dedicated ? envSecretBox() : { encrypt: unavailable("Encryption"), decrypt: unavailable("Encryption") },
    platformMigrations: PLATFORM_MIGRATIONS,
    tenantMigrations: TENANT_MIGRATIONS,
    connectRetries: { tries: 4, delayMs: 1500 },
  };
}

/** True when this deployment can create organizations. */
export function signupsOpen(): boolean {
  try { provisionDeps(); return true; } catch { return false; }
}
