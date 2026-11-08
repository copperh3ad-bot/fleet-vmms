#!/bin/bash
# Runs the tests that touch the restricted database roles (workshop links, invoice links, emailed estimates, driver odometer links, WhatsApp intake) against a real
# Postgres with an account that is NOT a superuser, which is how the live database behaves (ADR-073).
#
# Why: the usual tests run on PGlite or as a superuser, and a superuser ignores table permissions. A workshop could not send an estimate on the live site
# ("permission denied for table job_card_events") while every test passed. Run this before a release that touches the database. Add --all to run the whole suite this way.
#
# Needs a local Postgres with psql on the socket in E2E_PGHOST (default /tmp). It creates the role fleet_owner and the database fleet_owner_test on that machine only.
set -e
cd "$(dirname "$0")/.."
HOST="${E2E_PGHOST:-/tmp}"
scripts/live-like-db.sh fleet_owner_test
export TEST_DATABASE_URL="postgres://fleet_owner@/fleet_owner_test?host=$HOST"
if [ "$1" = "--all" ]; then
  npx vitest run --no-file-parallelism
else
  # one file at a time: each file rebuilds the same database
  npx vitest run --no-file-parallelism tests/quotation-link.test.ts tests/invoice-link.test.ts tests/inbound-email.test.ts tests/odometer-link.test.ts tests/whatsapp-inbound.test.ts tests/workshop-whatsapp.test.ts
fi
