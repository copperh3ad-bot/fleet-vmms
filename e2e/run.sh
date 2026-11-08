#!/bin/bash
# Runs the whole browser beta test on this machine, against a throwaway database and a stand-in for Supabase login and file storage.
# Needs: Postgres with psql on the socket in E2E_PGHOST (default /tmp), Node, and a Chrome or Chromium (PLAYWRIGHT_CHROMIUM=/path/to/it,
# or `npx playwright-core install chromium`). It touches nothing outside this machine. Usage: bash e2e/run.sh [scenario ...]
set -e
cd "$(dirname "$0")/.."
export E2E_DB="${E2E_DB:-fleet_vmms_e2e}" E2E_PGHOST="${E2E_PGHOST:-/tmp}"
export NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54399" NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY="local-test-key"
export DATABASE_URL="postgres:///${E2E_DB}?host=${E2E_PGHOST}"
# The email hook (ADR-024): mail is written to a file instead of sent, and the hook secret is a made-up one for this run only.
export SUPABASE_SERVICE_ROLE_KEY="e2e-only-service-key"   # the stand-in login service accepts any key; this switches the feature on for the run
export E2E_OUTBOX="${E2E_OUTBOX:-/tmp/fleet-otg-e2e-outbox.jsonl}"
rm -f "$E2E_OUTBOX"
# WhatsApp is written to a file instead of sent (ADR-055: joining with a code needs a confirmation on WhatsApp). Invitation codes stay off here, as before.
export E2E_WHATSAPP="${E2E_WHATSAPP:-/tmp/fleet-otg-e2e-whatsapp.jsonl}" WHATSAPP_FILE="${E2E_WHATSAPP:-/tmp/fleet-otg-e2e-whatsapp.jsonl}" WHATSAPP_OTP_TEMPLATE="fleetotg_code" INVITE_CODE_CHANNEL="off"
rm -f "$E2E_WHATSAPP"
export AUTH_HOOK_SECRET="v1,whsec_$(printf "e2e-only-hook-secret-0123456789" | base64)" SMTP_URL="file:${E2E_OUTBOX}" EMAIL_FROM="Fleet OTG <noreply@example.test>" ALLOW_FILE_MAILER=1
psql -h "$E2E_PGHOST" -d postgres -c "drop database if exists ${E2E_DB}" -c "create database ${E2E_DB}" >/dev/null
npx tsx scripts/migrate-tenants.mts >/dev/null
# A clean build every time. The build cache is shared with the real deploys, which use different settings; reusing it once produced a build whose pages
# asked for script files that were never written (static files answered 500 and seven scenarios failed for no reason in the app).
rm -rf .next
npm run build > e2e/build.out 2>&1 || { tail -20 e2e/build.out; exit 1; }
node e2e/check-build.mjs || { echo "the build is incomplete: a page refers to a script file that was not written"; exit 1; }
node e2e/mock-supabase.mjs > e2e/mock.log 2>&1 & MOCK=$!
npx next start -p 3100 > e2e/app.log 2>&1 & APP=$!
trap 'kill $MOCK $APP 2>/dev/null' EXIT
for i in $(seq 1 40); do curl -s -o /dev/null http://127.0.0.1:3100/api/health && break; sleep 1; done
node e2e/run.mjs "$@" || STATUS=$?
echo "report: e2e/report.json   screenshots of failures: e2e/shots"
exit ${STATUS:-0}
