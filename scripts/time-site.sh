#!/bin/sh
# Usage: scripts/time-site.sh [https://your-site]
# How long pages take to start answering, from where you run it (5 tries each, in milliseconds, fastest and slowest).
# /api/health does no database work, / reads the plan from the database, /login is a static form.
# Read-only: it only fetches public pages.
U="${1:-https://fleet-vmms-beta.netlify.app}"
for p in /api/health /login /; do
  for i in 1 2 3 4 5; do curl -s -m 30 -o /dev/null -w "%{time_starttransfer}\n" "$U$p"; done | sort -n | awk -v p="$p" '{a[NR]=$1} END {printf "%-12s fastest %4d ms   slowest %4d ms\n", p, a[1]*1000, a[NR]*1000}'
done
