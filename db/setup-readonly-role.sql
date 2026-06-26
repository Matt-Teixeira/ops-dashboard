-- db/setup-readonly-role.sql
-- One-time setup of the least-privilege role ops-dashboard connects as.
-- Run as a superuser against the database that holds util.app_run_logs:
--   psql -h <host> -U postgres -d staging -f db/setup-readonly-role.sql
--
-- The dashboard is read-only, so its credential should be too. This role can
-- ONLY connect and SELECT from util.app_run_logs -- no writes, no DDL, no other
-- tables. Reads go through the partitioned parent, so a single SELECT grant on
-- the parent also covers existing and future monthly partitions.

\set ON_ERROR_STOP on

-- Set a real password before running (or ALTER it afterwards):
--   \set ro_pw 'choose-a-strong-password'
\if :{?ro_pw}
\else
  \echo 'ERROR: set :ro_pw first, e.g.  psql -v ro_pw=secret -f db/setup-readonly-role.sql'
  \quit
\endif

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_dashboard_ro') THEN
    EXECUTE format('CREATE ROLE ops_dashboard_ro WITH LOGIN PASSWORD %L', :'ro_pw');
  ELSE
    EXECUTE format('ALTER ROLE ops_dashboard_ro WITH LOGIN PASSWORD %L', :'ro_pw');
  END IF;
END$$;

GRANT CONNECT ON DATABASE staging TO ops_dashboard_ro;
GRANT USAGE   ON SCHEMA   util     TO ops_dashboard_ro;
GRANT SELECT  ON util.app_run_logs TO ops_dashboard_ro;

-- Sanity: this role must NOT be able to write. (Expected: permission denied.)
--   SET ROLE ops_dashboard_ro;
--   INSERT INTO util.app_run_logs(app_name, run_id) VALUES ('x', gen_random_uuid());
