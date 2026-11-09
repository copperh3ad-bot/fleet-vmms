// Keeps the web server warm (the site felt slow on the first visit after a quiet spell: a cold start of the 118 MB server takes about 2.5 seconds).
// Every four minutes it asks the health page and the sign-in page for a reply, which is enough to keep an instance of the server ready.
// A scheduled function has no web address and cannot be called from outside, so this adds no public endpoint (CLAUDE.md rule 5).
import type { Config } from "@netlify/functions";

const run = async () => {
  const base = process.env.URL;                                  // Netlify sets this to the site's main address
  if (!base) { console.log("URL is not set; nothing to warm"); return; }
  for (const path of ["/api/health", "/login"]) {
    const t0 = Date.now();
    try { const r = await fetch(base + path, { headers: { "user-agent": "fleetotg-keep-warm" } }); console.log(`${path} ${r.status} in ${Date.now() - t0} ms`); }
    catch (e) { console.log(`${path} failed: ${e instanceof Error ? e.message : String(e)}`); }
  }
};

export default run;

export const config: Config = { schedule: "*/4 * * * *" };
