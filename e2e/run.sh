#!/bin/bash
# Runs the whole browser beta test on this machine, against a throwaway database and a stand-in for Supabase login and file storage.
# Needs: Postgres with psql on the socket in E2E_PGHOST (default /tmp), Node, and a Chrome or Chromium (PLAYWRIGHT_CHROMIUM=/path/to/it,
# or `npx playwright-core install chromium`). It touches nothing outside this machine. Usage: bash e2e/run.sh [scenario ...]
set -e
cd "$(dirname "$0")/.."
export E2E_DB="${E2E_DB:-fleet_vmms_e2e}" E2E_PGHOST="${E2E_PGHOST:-/tmp}"
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54399" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="local-test-key"
export DATABASE_URL="postgres:///${E2E_DB}?host=${E2E_PGHOST}"
psql -h "$E2E_PGHOST" -d postgres -c "drop database if exists ${E2E_DB}" -c "create database ${E2E_DB}" >/dev/null
npx tsx scripts/migrate-tenants.mts >/dev/null
find .next -name "* [0-9]*" -delete 2>/dev/null || true
npm run build > e2e/build.out 2>&1 || { tail -20 e2e/build.out; exit 1; }
node e2e/mock-supabase.mjs > e2e/mock.log 2>&1 & MOCK=$!
npx next start -p 3100 > e2e/app.log 2>&1 & APP=$!
trap 'kill $MOCK $APP 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:3100/api/health && break; sleep 1; done
node e2e/run.mjs "$@" || STATUS=$?
echo "report: e2e/report.json   screenshots of failures: e2e/shots"
exit ${STATUS:-0}
