# Deployment & Smoke-Test Runbook

`ops-dashboard` runs in Docker on the same host as the rest of `/opt/apps`,
attached to the external `pg_net` network. It is a **long-running service**
(`docker compose up -d`), unlike the suite's one-shot batch apps. `node` is not
installed on the host — all build/run happens in containers.

## One-time setup

```bash
# 1. Least-privilege DB role (run as a superuser, once):
psql -h <host> -U postgres -d staging -v ro_pw='<choose-strong-pw>' \
  -f db/setup-readonly-role.sql

# 2. Bind-mount target dirs, owned by the svc user/group (UID 105 / GID 987) so
#    the container (which runs as 105:987) can write node_modules into the cache:
sudo install -d -o 105 -g 987 \
  /opt/resources/node_mod_cache/ops-dashboard /opt/run-logs/ops-dashboard
#    (If you're in the docker group and the parent dirs are setgid + group-writable,
#     plain `install -d` also works, since the container runs as GID 987.)

# 3. Env file:
cp .env.example .env
#    set PGUSER=ops_dashboard_ro and PGPASSWORD=<the role's password>
```

## Install & start

```bash
docker compose run --rm app npm install   # installs into the bind-mounted cache
docker compose up -d                       # starts the service on the published port
docker compose logs --no-log-prefix | tail # expect: "listening on :8080"
```

Source is bind-mounted, so most code changes need only `docker compose restart`.
A `.env` change needs `docker compose up -d` (recreate). A dependency change needs
the `npm install` step again.

### Grant changes (e.g. Phase 10 connectivity, Phase 15 acquisition)

`db/setup-readonly-role.sql` is idempotent. When a phase widens the read-only role's
grants (Phase 10 added `SELECT` on the `alert.*` connectivity tables; Phase 15 added
`SELECT` on `stats.acquisition_history`), **re-run it as a superuser BEFORE restarting
with the new code** — otherwise the new endpoint returns 500 (`permission denied for
schema alert`/`stats`) until the grant lands:

```bash
psql -h <host> -U postgres -d staging -v ro_pw='<existing-pw>' \
  -f db/setup-readonly-role.sql      # ro_pw is required by the script; reuse the current password
# then, as ops_dashboard_ro, confirm the new reads work:
#   SELECT count(*) FROM alert.offline_hhm_conn;  SELECT count(*) FROM alert.offline_mmb_conn;
docker compose restart
```

## Smoke test (run after any deploy that touches routing, queries, creds, or compose)

```bash
curl -s localhost:8080/healthz                       # {"ok":true}

# Grid warms in the background (first refresh ~tens of seconds). Until then the
# endpoint returns 503 "warming". Poll until 200, then expect a fast response:
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" localhost:8080/api/jobs/latest

curl -s "localhost:8080/api/errors?limit=5"          # recent WARN/ERROR events
curl -s -o /dev/null -w "%{http_code}\n" localhost:8080/api/runs/not-a-uuid   # expect 400

curl -s -o /dev/null -w "%{http_code}\n" localhost:8080/api/connectivity      # expect 200 (500 => alert grant not applied)
curl -s -o /dev/null -w "%{http_code}\n" localhost:8080/api/acquisition/systems  # expect 200 (500 => stats grant not applied)
```

A green smoke test = healthz ok, grid serves 200 in well under a second once
warm, error feed returns events, and input validation rejects bad ids.

## Rollback

```bash
git checkout <previous-good-sha>
docker compose restart        # or `up -d` if .env/compose changed
```

## Notes

- The published host port is set in `docker-compose.yaml` (`8080:8080`); change the
  host side if 8080 is taken.
- Deployment is host-internal with no auth, by decision. If exposure changes, add
  auth in its own phase before publishing more broadly (see PROMPTS open decisions).
- The heavy grid query runs on a background interval, not per request — a slow
  refresh does not slow user requests, but watch the refresh duration in logs as the
  table grows (the Phase 4 summary table retires this cost).
