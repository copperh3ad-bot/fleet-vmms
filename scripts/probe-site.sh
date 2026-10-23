#!/bin/sh
# Usage: scripts/probe-site.sh https://your-site
# Looks at the public side of a deployed site: which pages answer, which redirect to sign-in. Sends nothing and changes nothing.
U="${1:-https://fleet-vmms-beta.netlify.app}"
echo "health: $(curl -s -m 20 "$U/api/health")"
TOK=$(printf 'A%.0s' $(seq 1 43))
for p in / /login /signup /signup/check-email /terms /privacy /setup /admin /w/demo/billing /auth/callback "/o/$TOK" "/invite/$TOK"; do
  curl -s -m 20 -o /dev/null -w "$p %{http_code} -> %{redirect_url}\n" "$U$p"
done
