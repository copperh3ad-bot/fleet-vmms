#!/bin/bash
# Makes sure the local Postgres has a database account that behaves like the live one: NOT a superuser (ADR-073). A superuser ignores table permissions, which hid a bug
# for months (a workshop could not send an estimate on the live site while every test passed). Used by e2e/run.sh and scripts/test-live-like.sh. Local machine only.
# Usage: scripts/live-like-db.sh [database-to-create-owned-by-fleet_owner]
set -e
HOST="${E2E_PGHOST:-/tmp}"
psql -h "$HOST" -d postgres -q >/dev/null <<'SQL'
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'fleet_owner') then create role fleet_owner login createrole createdb; end if;
end $$;
SQL
# the restricted roles the migrations create are cluster-wide; the owner needs admin rights over any that already exist
for r in odometer_link quotation_link inbound_mail; do
  psql -h "$HOST" -d postgres -q -c "do \$\$ begin if exists (select 1 from pg_roles where rolname = '$r') then execute 'grant $r to fleet_owner with admin option'; end if; end \$\$;" >/dev/null
done
if [ -n "$1" ]; then
  psql -h "$HOST" -d postgres -q -tc "select 1 from pg_database where datname = '$1'" | grep -q 1 || psql -h "$HOST" -d postgres -q -c "create database $1 owner fleet_owner" >/dev/null
fi
