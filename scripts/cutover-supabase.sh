#!/bin/sh
# Usage: scripts/cutover-supabase.sh check|prepare|switch
# Moves the site to the Supabase project described in .env.sg (the Singapore one). Prints no secrets.
#   check    reads .env.sg, makes sure the connection string was filled in, and tests that the database answers
#   prepare  builds the new database's tables (platform, control, file bucket and policies); changes only the NEW project
#   switch   copies the three values to Netlify as production variables and deploys. After this, the site uses the new project.
set -e
cd "$(dirname "$0")/.."
[ -f .env.sg ] || { echo ".env.sg is missing"; exit 2; }
set -a; . ./.env.sg; set +a
case "$DATABASE_URL" in postgres*) ;; *) echo "Fill in DATABASE_URL in .env.sg first (the Transaction pooler connection string)."; exit 2;; esac
case "$NEXT_PUBLIC_SUPABASE_URL" in *sumjdoeahaopadmcjhso*) ;; *) echo "NEXT_PUBLIC_SUPABASE_URL is not the new project."; exit 2;; esac
case "$1" in
  check)
    npx tsx -e 'import { pgDriver } from "./src/lib/db/pg-driver"; const d = pgDriver(process.env.DATABASE_URL!, { max: 1 }); const t0 = Date.now(); const r = await d.transaction((q) => q.query("select current_database() as db, version() as v, (select count(*) from auth.users) as users")); await d.end(); console.log("database answers:", JSON.stringify(r.rows[0]).replace(/PostgreSQL ([0-9.]+).*/, "PostgreSQL $1"), `(${Date.now() - t0} ms for one round trip including connect)`);'
    ;;
  prepare)
    npx tsx scripts/migrate-tenants.mts
    npx tsx scripts/migrate-tenants.mts --check
    ;;
  switch)
    npx netlify-cli env:set NEXT_PUBLIC_SUPABASE_URL "$NEXT_PUBLIC_SUPABASE_URL" --context production >/dev/null
    npx netlify-cli env:set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY "$NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY" --context production >/dev/null
    npx netlify-cli env:set DATABASE_URL "$DATABASE_URL" --secret --context production >/dev/null
    echo "Netlify variables updated. Building and deploying."
    npm run build >/dev/null 2>&1
    npx netlify-cli deploy --build --prod --context production 2>&1 | grep -E "Deploy is live|Production URL|rror"
    ;;
  *) echo "Usage: $0 check|prepare|switch"; exit 2;;
esac
