# Deployment & Smoke-Test Runbook

`ops-dashboard` follows the fleet **dev/release paradigm**
(`data_acquisition/docs/migration_CLAUDE.md`, Part 1). It is the suite's one
**long-running service** (`docker compose up -d`, `restart: unless-stopped`),
attached to the external `pg_net` network. `node` is not installed on the
host — all build/run happens in containers.

**The two copies:**

| Copy | Path | Compose project | Port | Identity |
| ---- | ---- | --------------- | ---- | -------- |
| Dev clone (editable git repo) | `~/apps/ops-dashboard` | `ops-dashboard-dev` | `8081` | `RUN_USER=<you>` |
| Release (build output, never edited) | `/opt/apps/ops-dashboard` | `ops-dashboard` | `8080` | svc (entrypoint default) |

`/opt/apps/ops-dashboard` is produced **only** by `build-release.sh`. Never
edit it, never `git pull` in it (it is not a repo), never run dev commands in
it. A `RELEASE_SHA` of `dev-tree` in the heartbeat record means production is
running the wrong copy.

## Deploying a change (the only production deploy path)

```bash
cd ~/apps/ops-dashboard
# ... commit your change, push ...
bash preflight-check.sh          # expect ZERO warnings
bash build.sh                    # dev image; run the dev smoke if the change warrants it
bash build-release.sh            # guarded release; see below
```

`build-release.sh` refuses a dirty tree (commit or stash first — `--allow-dirty`
is an emergency override, never habit), mirrors the working tree to
`/opt/apps/ops-dashboard` (preserving `node_modules` as an install cache),
applies the `#RELEASE:` overrides to the deployed `.env` (`USER_ID=svc`,
`COMPOSE_PROJECT_NAME=ops-dashboard`, `HOST_PORT=8080`), stamps `RELEASE_SHA`,
builds `ops-dashboard:svc` as svc, and **restarts the service** (`docker
compose up -d` from the release copy). The recreate happens on **every**
release — the freshly stamped `RELEASE_SHA` is part of the container's
`env_file`, so even a docs-only release changes the container env (observed
2026-08-26; the upside is the boot line always matches the deployed commit).
Expect a few seconds of API outage plus a grid re-warm (~1–2 min of 503
"warming"). Well under the 15-minute heartbeat staleness budget, so the
dashboard's own grid row stays green through a deploy.

Then verify:

```bash
grep '^RELEASE_SHA=' /opt/apps/ops-dashboard/.env    # the commit you meant to ship
curl -s localhost:8080/healthz                        # {"ok":true}
docker logs ops-dashboard-app-1 2>&1 | grep 'boot release_sha'
(cd /opt/apps/ops-dashboard && bash preflight-check.sh)   # exercises the release-copy branch
```

And in the database (the record, not the intent) — within ~10 minutes the
heartbeat must carry the released SHA:

```sql
SELECT (verbose_log->0->'note'->>'RELEASE_SHA') sha,
       (verbose_log->0->'note'->>'USER_ID') uid, COUNT(*), MAX(inserted_at)
FROM util.app_run_logs
WHERE app_name='ops-dashboard' AND inserted_at > now() - interval '1 hour'
GROUP BY 1, 2;
```

## One-time setup

```bash
# 1. Least-privilege DB roles (superuser, once; password-file pattern):
docker exec -i pg_db psql -U postgres -d staging -v ro_pw="$(sudo cat /root/ops_dashboard_ro_pw)" < db/setup-readonly-role.sql
# Only if SELF_LOG_ENABLED=true:
docker exec -i pg_db psql -U postgres -d staging -v rw_pw="$(sudo cat /root/ops_dashboard_rw_pw)" < db/setup-writer-role.sql

# 2. Dev clone + .env (see README "First-time setup").
```

No host directories are needed: the app writes no files (self-log goes to the
DB), and `node_modules` lives in-tree in each copy.

### Grant changes (e.g. connectivity, acquisition endpoints)

`db/setup-readonly-role.sql` is idempotent. When a phase widens the read-only
role's grants, **re-run it as a superuser BEFORE releasing the new code** —
otherwise the new endpoint returns 500 (`permission denied`) until the grant
lands:

```bash
docker exec -i pg_db psql -U postgres -d staging -v ro_pw="$(sudo cat /root/ops_dashboard_ro_pw)" < db/setup-readonly-role.sql
bash build-release.sh        # release + restart picks up the new code
```

After any **staging DB reset**, re-run both role scripts (grants are wiped
with the roles' target objects) and restart the service, or the dashboard
serves empty data.

## Smoke test (dev clone, before releasing anything risky)

```bash
RUN_USER=$(id -un) docker compose up -d      # project ops-dashboard-dev, :8081
curl -s localhost:8081/healthz               # {"ok":true}
# Grid warms in the background (bootstrap scans the retention window; ~1-2 min
# on this data). Until then the endpoint returns 503 "warming":
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" localhost:8081/api/jobs/latest
curl -s "localhost:8081/api/errors?limit=5"
curl -s -o /dev/null -w "%{http_code}\n" localhost:8081/api/runs/not-a-uuid   # expect 400
curl -s -o /dev/null -w "%{http_code}\n" localhost:8081/api/connectivity      # 500 => alert grant missing
curl -s -o /dev/null -w "%{http_code}\n" localhost:8081/api/acquisition/systems  # 500 => stats grant missing
docker compose down
```

A dev run against the shared staging DB is a real run: with
`SELF_LOG_ENABLED=true` it writes heartbeat rows under
`app_name=ops-dashboard`, distinguishable by `RELEASE_SHA=dev-tree` /
`USER_ID=<you>` in the boot note. That is expected for a deliberate smoke
test; don't leave a dev instance running unattended.

## Rollback

```bash
cd ~/apps/ops-dashboard
git revert <bad-sha>       # or: git checkout -b rollback <previous-good-sha>
bash build-release.sh      # re-release; never edit /opt/apps directly
```

## Notes

- The published production port is `8080` (dev `8081`), host-internal with no
  auth, by decision. If exposure changes, add auth in its own phase before
  publishing more broadly (see PROMPTS open decisions).
- Container logs are capped in compose (json-file, 10m × 3) and carry the boot
  provenance line — they are the console record of which commit is serving.
- The heavy grid query runs on a background interval, not per request — a slow
  refresh does not slow user requests; watch the refresh duration in logs as
  the table grows.
