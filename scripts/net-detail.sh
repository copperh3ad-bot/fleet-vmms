#!/bin/sh
# Usage: scripts/net-detail.sh [https://your-site]
# Splits one page's time into steps, so you can see how much is the distance between you and the site and how much is the
# site's own work: name lookup, TCP connect, TLS, then first byte. Also prints the Netlify region fields. Read-only.
U="${1:-https://fleet-vmms-beta.netlify.app}"
cd "$(dirname "$0")/.."
npx netlify-cli api getSite --data '{"site_id":"fef909c4-2e39-49ba-8cbf-6cab059dd22e"}' 2>/dev/null | python3 -c '
import json, sys
d = json.load(sys.stdin)
def walk(o, p=""):
    if isinstance(o, dict):
        for k, v in o.items():
            if "region" in k.lower(): print(p + k, "=", v)
            walk(v, p + k + ".")
walk(d)'
for i in 1 2 3 4; do
  curl -s -o /dev/null -w "dns %{time_namelookup}s  tcp %{time_connect}s  tls %{time_appconnect}s  first byte %{time_starttransfer}s\n" -m 30 "$U/api/health"
done
