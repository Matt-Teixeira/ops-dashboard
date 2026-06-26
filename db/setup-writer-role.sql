-- db/setup-writer-role.sql
-- One-time setup of the ONLY sanctioned write path for ops-dashboard self-logging.
-- Run as a superuser against the DB that holds util.app_run_logs:
--   psql -h <host> -U postgres -d staging -v rw_pw='choose-a-strong-password' \
--     -f db/setup-writer-role.sql
--
-- Design (Phase 7): the dashboard is read-only over pipeline data; the one exception
-- is logging its OWN runs (app_name = 'ops-dashboard'). That exception is enforced by
-- the DATABASE, not by app code:
--   - ops.log_ops_dashboard_run(...) is a SECURITY DEFINER function that hard-codes
--     app_name = 'ops-dashboard'. It is the only way the app can write.
--   - ops_writer_owner owns the function and is the only role with INSERT on
--     util.app_run_logs. It is NOLOGIN, so no client can connect as it.
--   - ops_dashboard_rw (the app's writer login) has EXECUTE on the function and
--     nothing else -- no direct INSERT, no other table, no other app_name.
-- We do NOT add a trigger or RLS to util.app_run_logs (shared, partitioned,
-- pipeline-owned) -- that could break the pipeline apps' inserts.

\set ON_ERROR_STOP on

\if :{?rw_pw}
\else
  \echo 'ERROR: set rw_pw first, e.g.  psql -v rw_pw=secret -f db/setup-writer-role.sql'
  \quit
\endif

-- 1. A schema we own for the write path (util stays pipeline-owned).
CREATE SCHEMA IF NOT EXISTS ops;

-- 2. The definer-owner: the ONLY role with INSERT on the shared log table, and it is
--    NOLOGIN so it is reachable only as the function's definer, never by a client.
SELECT 'CREATE ROLE ops_writer_owner NOLOGIN'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_writer_owner')
\gexec
GRANT USAGE  ON SCHEMA util       TO ops_writer_owner;
GRANT INSERT ON util.app_run_logs TO ops_writer_owner;  -- on the parent; covers partitions
GRANT USAGE  ON SCHEMA ops        TO ops_writer_owner;

-- 3. The only write path. Hard-codes app_name; parameterized; fixed search_path so a
--    SECURITY DEFINER function can't be hijacked via search_path.
CREATE OR REPLACE FUNCTION ops.log_ops_dashboard_run(
  p_run_id          uuid,
  p_verbose_log     json,
  p_warn_error_logs json
) RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  INSERT INTO util.app_run_logs (app_name, run_id, verbose_log, warn_error_logs)
  VALUES ('ops-dashboard', p_run_id, p_verbose_log, p_warn_error_logs);
$$;
ALTER FUNCTION ops.log_ops_dashboard_run(uuid, json, json) OWNER TO ops_writer_owner;
-- Functions are EXECUTE-to-PUBLIC by default; lock it down before re-granting.
REVOKE ALL ON FUNCTION ops.log_ops_dashboard_run(uuid, json, json) FROM PUBLIC;

-- 4. The app's writer login role: EXECUTE the function, nothing else.
SELECT format('CREATE ROLE ops_dashboard_rw LOGIN PASSWORD %L', :'rw_pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ops_dashboard_rw')
\gexec
ALTER ROLE ops_dashboard_rw LOGIN PASSWORD :'rw_pw';
GRANT CONNECT ON DATABASE staging TO ops_dashboard_rw;
GRANT USAGE   ON SCHEMA ops       TO ops_dashboard_rw;
GRANT EXECUTE ON FUNCTION ops.log_ops_dashboard_run(uuid, json, json) TO ops_dashboard_rw;

-- Sanity (expected): as ops_dashboard_rw, SELECT ops.log_ops_dashboard_run(...) works
-- and writes an 'ops-dashboard' row; a direct INSERT INTO util.app_run_logs is DENIED.
