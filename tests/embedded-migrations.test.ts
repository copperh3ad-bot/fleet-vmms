import { describe, expect, it } from "vitest";
import { loadMigrations } from "@/lib/db/migrate";
import { CONTROL_MIGRATIONS, PLATFORM_MIGRATIONS, TENANT_MIGRATIONS } from "@/lib/db/embedded-migrations";

// The site creates organizations at run time from the copy inside the build. If someone adds a migration and forgets
// to regenerate it, new organizations would be built from an older layout.
describe("the migrations inside the build", () => {
  it.each([["platform", PLATFORM_MIGRATIONS, "db/public"], ["control", CONTROL_MIGRATIONS, "db/control"], ["tenant", TENANT_MIGRATIONS, "db/tenant-template"]] as const)(
    "%s matches the files on disk (run: npm run embed:migrations)", (_n, embedded, dir) => {
      const disk = loadMigrations(dir);
      expect(embedded.map((m) => [m.name, m.checksum])).toEqual(disk.map((m) => [m.name, m.checksum]));
      expect(embedded.map((m) => m.sql)).toEqual(disk.map((m) => m.sql));
    });
});
