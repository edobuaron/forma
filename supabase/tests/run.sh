#!/usr/bin/env bash
# Runs migrations + SQL tests against a throwaway local Postgres database.
# Usage: PGHOST=/var/tmp PGPORT=54329 PGUSER=postgres supabase/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
P="psql -v ON_ERROR_STOP=1 -q"
$P -d postgres -c 'drop database if exists forma_test' -c 'create database forma_test'
$P -d forma_test -f supabase/tests/00_stub_supabase.sql
for f in supabase/migrations/*.sql; do $P -d forma_test -f "$f"; done
$P -d forma_test -f supabase/tests/01_rls_test.sql
$P -d forma_test -f supabase/tests/02_workout_flow_test.sql
$P -d forma_test -f supabase/tests/03_edit_and_records_test.sql

$P -d forma_test -f supabase/tests/04_finish_test.sql
$P -d forma_test -f supabase/tests/05_shortfall_test.sql
$P -d forma_test -f supabase/tests/06_onboarding_catalog_test.sql
$P -d forma_test -f supabase/tests/08_sides_attachments_test.sql
$P -d forma_test -f supabase/tests/10_maintenance_muscles_test.sql
$P -d forma_test -f supabase/tests/11_drop_sets_test.sql
$P -d forma_test -f supabase/tests/12_plan_import_test.sql

# Upgrade path: an account created before migration 009 must keep everything.
$P -d postgres -c 'drop database if exists forma_upgrade_test' -c 'create database forma_upgrade_test'
$P -d forma_upgrade_test -f supabase/tests/00_stub_supabase.sql
for f in supabase/migrations/*.sql; do
  [[ "$(basename "$f")" == 20261027000009_* ]] && $P -d forma_upgrade_test -f supabase/tests/07_pre_009_fixture.sql
  $P -d forma_upgrade_test -f "$f"
done
$P -d forma_upgrade_test -f supabase/tests/07_upgrade_test.sql

# Upgrade to 011 with representative existing data: workouts (completed, shortened, in progress),
# user-edited exercises, records and two accounts. Every pre-upgrade row must survive unchanged.
$P -d postgres -c 'drop database if exists forma_upgrade_011' -c 'create database forma_upgrade_011'
$P -d forma_upgrade_011 -f supabase/tests/00_stub_supabase.sql
for f in supabase/migrations/*.sql; do
  [[ "$(basename "$f")" == 20261029000011_* ]] && $P -d forma_upgrade_011 -f supabase/tests/09_pre_011_fixture.sql
  $P -d forma_upgrade_011 -f "$f"
done
$P -d forma_upgrade_011 -f supabase/tests/09_upgrade_011_test.sql
