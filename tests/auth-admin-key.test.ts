// Supabase's service key can create, change and delete any login (ADR-025). It is read in exactly one file, and that file is used by exactly
// one other, so a careless new import cannot hand it to a page, an action or a browser bundle.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mts)$/.test(n) ? [p] : [];
  });
}
const sources = [...files("src"), ...files("scripts")].filter((f) => !f.endsWith("embedded-migrations.ts"));

describe("the service key", () => {
  it("is named in one file only", () => {
    expect(sources.filter((f) => readFileSync(f, "utf8").includes("SUPABASE_SERVICE_ROLE_KEY"))).toEqual([join("src", "lib", "supabase", "admin.ts")]);
  });
  it("is reached only through the sign-in-name service and the one file store", () => {
    const users = sources.filter((f) => /from "@\/lib\/supabase\/admin"/.test(readFileSync(f, "utf8")));
    expect(users.sort()).toEqual([join("src", "lib", "admin", "service.ts"), join("src", "lib", "supabase", "blob-store.ts")]);
  });
  it("the file store checks the caller's folders before every file operation, and the browser has no storage client", () => {
    const store = readFileSync(join("src", "lib", "supabase", "blob-store.ts"), "utf8");
    for (const op of ["put", "remove", "get", "signedUrl"]) expect(store, op).toMatch(new RegExp(`async ${op}\\([^)]*\\) \\{[^}]*guard\\(`));
    expect(sources.filter((f) => /\.storage\.from\(/.test(readFileSync(f, "utf8")))).toEqual([]);
    expect(sources.filter((f) => /createBrowserClient/.test(readFileSync(f, "utf8")))).toEqual([]);
  });
  it("is never imported by a file that runs in the browser", () => {
    const client = sources.filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));
    for (const f of client) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/supabase\/admin|admin\/service|login-names/);
    }
  });
  it("is never printed or logged", () => {
    const text = readFileSync(join("src", "lib", "supabase", "admin.ts"), "utf8");
    expect(text).not.toMatch(/console\./);
  });
});
