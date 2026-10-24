// On the shared database a few tables hold the rows of several organizations at once (memberships, invitations, odometer
// links, subscriptions). Any query on them that forgets to say which organization would show people the others' rows.
// This reads the source and fails on any use of those tables with no organization (or login, or token) condition nearby,
// so a careless new query is caught before it ships. It is a net, not a proof: cross-org.test.ts is the behavioural check.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SHARED_TABLES = ["tenant_memberships", "invitations", "odometer_links", "tenant_subscriptions", "join_requests", "org_tax"];
// A condition that pins the query to one organization, one login's own rows, or one secret token.
const PINNED = /tenant_id|user_id\s*=|token_hash|schema_name|\bt\.id\b|t\.slug|i\.id = \$|where id = \$|submission_id/;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mts)$/.test(n) ? [p] : [];
  });
}

describe("queries on tables that hold several organizations' rows", () => {
  it("each one names the organization, the login or the token it is about", () => {
    const loose: string[] = [];
    for (const f of [...files("src"), ...files("scripts")].filter((x) => !x.endsWith("embedded-migrations.ts"))) {   // generated table definitions, not queries
      const text = readFileSync(f, "utf8");
      for (const t of SHARED_TABLES) {
        const re = new RegExp(`public\\.${t}\\b`, "g");
        for (let m = re.exec(text); m; m = re.exec(text)) {
          // the statement around it: back to the previous quote or backtick and forward to the next closing one
          const from = Math.max(text.lastIndexOf("\n", m.index - 1) - 200, 0), to = Math.min(m.index + 450, text.length);
          const around = text.slice(from, to);
          if (/^\s*\/\/|^\s*\*/m.test(text.slice(text.lastIndexOf("\n", m.index) + 1, m.index))) continue;       // a comment, not a query
          if (!PINNED.test(around)) loose.push(`${f}:${text.slice(0, m.index).split("\n").length} public.${t}`);
        }
      }
    }
    expect(loose, "add a tenant_id condition (or document why none is needed by pinning to a login or token)").toEqual([]);
  });
});
