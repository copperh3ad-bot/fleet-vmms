// Fails if any page of the build refers to a client script that is not in .next/static/chunks (an incomplete build). Run by e2e/run.sh and before a deploy.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const root = ".next";
const manifests = walk(join(root, "server")).filter((f) => /client-reference-manifest\.js$/.test(f));
const missing = new Map();
let refs = 0;
for (const f of manifests) {
  const s = readFileSync(f, "utf8");
  for (const m of s.matchAll(/static\/chunks\/([A-Za-z0-9_.\-~$]+\.js)/g)) {
    refs++;
    if (!existsSync(join(root, "static/chunks", m[1]))) (missing.get(m[1]) ?? missing.set(m[1], new Set()).get(m[1])).add(f.replace(root + "/server/", ""));
  }
}
console.log("manifests:", manifests.length, "| chunk references:", refs, "| distinct chunks missing:", missing.size);
for (const [c, fs] of [...missing].slice(0, 8)) console.log(" missing", c, "<-", [...fs].slice(0, 2).join(", "));
const files = readdirSync(join(root, "static/chunks")).length;
console.log("files in .next/static/chunks:", files);
process.exit(missing.size ? 1 : 0);
