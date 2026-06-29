-- db/setup-readonly-role.sql
-- One-time setup of the least-privilege role ops-dashboard connects as.
-- Run as a superuser against the database that holds util.app_run_logs:
--   psql -h <host> -U postgres -d staging -v ro_pw='choose-a-strong-password' \
--     -f db/setup-readonly-role.sql
--
-- The dashboard is read-only, so its credential should be too. This role can
-- ONLY connect and SELECT from util.app_run_logs and the two alert.* connectivity
-- tables -- no writes, no DDL, no other tables. Reads of util.app_run_logs go
-- through the partitioned parent, so a single SELECT grant on the parent also
-- covers existing and future monthly partitions.
--
-- Phase 10 added the first read OUTSIDE schema util: the connectivity panel selects
-- the latest per-system state from alert.offline_hhm_conn / alert.offline_mmb_conn
-- (one upserted row per system_id; written by data_acquisition). Still SELECT-only.
-- This file is idempotent; re-run it (as a superuser) to apply the new grants
-- BEFORE deploying the Phase 10 code, or /api/connectivity returns 500
-- (permission denied for schema alert). See markdown/DEPLOYMENT.md.

\set ON_ERROR_STOP on

-- Require the password variable (must be set with -v ro_pw=...).
\if :{?ro_pw}
\else
  \echo 'ERROR: set ro_pw first, e.g.  psql -v ro_pw=secret -f db/setup-readonly-role.sql'
  \quit
\endif

-- Create the role only if it does not already exist. psql expands :'ro_pw' here
-- because it sits in a normal SQL string (NOT a dollar-quoted body, where
-- interpolation would not happen); \gexec then runs the generated statement.
SELECT format('CREATE ROLE ops_dashboard_ro LOGIN PASSWORD %L', :'ro_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_dashboard_ro')
\gexec

-- Ensure the password is set (idempotent; safe whether or not the role existed).
ALTER ROLE ops_dashboard_ro LOGIN PASSWORD :'ro_pw';

GRANT CONNECT ON DATABASE staging TO ops_dashboard_ro;
GRANT USAGE   ON SCHEMA   util     TO ops_dashboard_ro;
GRANT SELECT  ON util.app_run_logs TO ops_dashboard_ro;

-- Connectivity panel (Phase 10): read the latest per-system connectivity state.
-- SELECT-only on exactly these two tables; no other object in schema alert.
GRANT USAGE   ON SCHEMA   alert                  TO ops_dashboard_ro;
GRANT SELECT  ON alert.offline_hhm_conn          TO ops_dashboard_ro;
GRANT SELECT  ON alert.offline_mmb_conn          TO ops_dashboard_ro;

-- Sanity: this role must NOT be able to write. (Expected: permission denied.)
--   SET ROLE ops_dashboard_ro;
--   INSERT INTO util.app_run_logs(app_name, run_id) VALUES ('x', gen_random_uuid());
-- Sanity: the connectivity reads should now succeed. (Expected: a row count.)
--   SET ROLE ops_dashboard_ro;
--   SELECT count(*) FROM alert.offline_hhm_conn;
--   SELECT count(*) FROM alert.offline_mmb_conn;
