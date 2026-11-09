import fs from "node:fs";
import path from "node:path";
import { close, findings, issues, launch, results, SHOTS, sql } from "./lib.mjs";

const only = process.argv.slice(2);
const S = {};                                        // what scenarios share: people, slugs, ids
const all = [
  ["public", () => import("./s1-public.mjs").then((m) => m.publicPages(S))],
  ["companies", () => import("./s2-companies.mjs").then((m) => m.companies(S))],
  ["workspace", () => import("./s3-workspace.mjs").then((m) => m.workspace(S))],
  ["people", () => import("./s4-people.mjs").then((m) => m.people(S))],
  ["departments", () => import("./s8-departments.mjs").then((m) => m.departments(S))],
  ["billing", () => import("./s5-billing.mjs").then((m) => m.billing(S))],
  ["lock", () => import("./s6-lock-isolation.mjs").then((m) => m.lockAndIsolation(S))],
  ["quality", () => import("./s7-quality.mjs").then((m) => m.quality(S))],
  ["vehicleform", () => import("./s9-vehicle-form.mjs").then((m) => m.vehicleForm(S))],
  ["workshopflow", () => import("./s11-workshop-flow.mjs").then((m) => m.workshopFlow(S))],
  ["outsourcedtrip", () => import("./s12-outsourced-trip.mjs").then((m) => m.outsourcedTrip(S))],
  ["decisionforms", () => import("./s10-decision-forms.mjs").then((m) => m.decisionForms(S))],
];

await launch();
sql("delete from public.rate_limits");          // the limits are tested on purpose in their own scenario; repeated runs must not trip them
const t0 = Date.now();
for (const [name, fn] of all) {
  if (only.length && !only.includes(name)) continue;
  try { await fn(); } catch (e) { console.log(`SCENARIO ABORTED (${name}): ${e.message}`); results.push({ scenario: name, step: "scenario ran to the end", ok: false, ms: 0, note: String(e.message).split("\n")[0] }); }
}
await close();

const pass = results.filter((r) => r.ok).length, fail = results.filter((r) => !r.ok);
console.log(`\n==== ${pass} passed, ${fail.length} failed, ${findings.length} findings, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
for (const f of fail) console.log(`FAIL [${f.scenario}] ${f.step}: ${f.note}`);
const browserIssues = [...issues.entries()].flatMap(([who, list]) => [...new Set(list)].map((l) => `${who}: ${l}`));
if (browserIssues.length) { console.log(`\nbrowser problems seen (${browserIssues.length}):`); for (const b of browserIssues.slice(0, 40)) console.log("  " + b); }
fs.writeFileSync(path.join(SHOTS, "..", "report.json"), JSON.stringify({ results, findings, browserIssues }, null, 2));
process.exit(fail.length ? 1 : 0);
