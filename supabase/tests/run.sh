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
