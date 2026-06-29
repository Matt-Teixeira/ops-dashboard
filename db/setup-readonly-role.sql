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

-- Connectivity panel (Phase 10): SELECT-only on exactly these two tables and
-- nothing else in schema alert. Fail closed rather than merely additive: first
-- strip any role-level privileges this role may have accumulated in schema alert,
-- then grant only the intended ones, then VERIFY no other privilege is effective
-- (including via PUBLIC or an inherited role membership). Re-running this script
-- then *proves* the "only these two tables" claim instead of just adding to it.
REVOKE ALL ON ALL TABLES IN SCHEMA alert FROM ops_dashboard_ro;
REVOKE ALL ON SCHEMA alert               FROM ops_dashboard_ro;

GRANT USAGE   ON SCHEMA   alert                  TO ops_dashboard_ro;
GRANT SELECT  ON alert.offline_hhm_conn          TO ops_dashboard_ro;
GRANT SELECT  ON alert.offline_mmb_conn          TO ops_dashboard_ro;

-- Verify EFFECTIVE privileges (has_*_privilege accounts for PUBLIC and role
-- membership, not just direct grants): ops_dashboard_ro may hold ONLY SELECT on
-- the two connectivity tables and no CREATE on the schema. Anything else aborts
-- the script (ON_ERROR_STOP is on), so drift is caught, not silently tolerated.
-- (A PUBLIC grant on another alert table will trip this by design.)
DO $$
DECLARE
  bad text;
BEGIN
  SELECT string_agg(n.nspname || '.' || c.relname || ':' || priv, ', ' ORDER BY c.relname, priv)
    INTO bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) AS priv
  WHERE n.nspname = 'alert'
    AND c.relkind IN ('r','p','v','m','f')   -- tables, partitioned tables, views, matviews, foreign tables
    AND has_table_privilege('ops_dashboard_ro', c.oid, priv)
    AND NOT (c.relname IN ('offline_hhm_conn','offline_mmb_conn') AND priv = 'SELECT');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'ops_dashboard_ro has unexpected privileges in schema alert: %', bad;
  END IF;
  IF has_schema_privilege('ops_dashboard_ro', 'alert', 'CREATE') THEN
    RAISE EXCEPTION 'ops_dashboard_ro unexpectedly has CREATE on schema alert';
  END IF;
END $$;

-- Sanity: this role must NOT be able to write. (Expected: permission denied.)
--   SET ROLE ops_dashboard_ro;
--   INSERT INTO util.app_run_logs(app_name, run_id) VALUES ('x', gen_random_uuid());
-- Sanity: the connectivity reads should now succeed. (Expected: a row count.)
--   SET ROLE ops_dashboard_ro;
--   SELECT count(*) FROM alert.offline_hhm_conn;
--   SELECT count(*) FROM alert.offline_mmb_conn;
