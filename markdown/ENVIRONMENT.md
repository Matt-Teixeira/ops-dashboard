# Environment

Rules and variable names only. **Never** put secret values (passwords, connection
strings, cert contents) in this file, other docs, prompts, or commits. The real
values live in `.env`, which is gitignored. `.env.example` is the committed
contract with safe placeholders.

## Variables

| Variable | Purpose | Notes |
| -------- | ------- | ----- |
| `APP_NAME` | Identifies this app | `ops-dashboard` |
| `PORT` | HTTP listen port | default `8080`; published host port set in compose |
| `PGHOST` | DB host | `pg_db` in-network; `localhost` from the host. Fallback: `PG_HOST` |
| `PGPORT` | DB port | `5432`. Fallback: `PG_PORT` |
| `PGUSER` | DB role | **`ops_dashboard_ro`** — the least-privilege role, not a superuser. Fallback: `PG_USER` |
| `PGPASSWORD` | DB password | secret; `.env` only. Fallback: `PG_PW` |
| `PGDATABASE` | DB name | `staging` (holds `util.app_run_logs`). Fallback: `PG_DB` |
| `PG_SSLMODE` | TLS mode | `disable` \| `require` \| `verify-ca` \| `verify-full` |
| `PG_SSL_PATH` | CA cert path | `/opt/resources/ssl/pg_ssl.crt`; required for `verify-*` |
| `ERRORS_LOOKBACK_DAYS` | Error-feed window (days) | default `2`; bounds the partition-pruned scan |
| `SUMMARY_RETENTION_DAYS` | Job-grid retention window (days) | default `30`; a job shows iff its last run is within it (dormant jobs stay visible as stale, then age out). Also the bootstrap scan window. |
| `SUMMARY_OVERLAP_MS` | Grid tick re-scan overlap | default `300000` (5 min); each tick scans back this far behind the watermark to absorb insert-lag skew |
| `SUMMARY_RECONCILE_MS` | Full re-scan interval | default `21600000` (6 h); every this long a tick does a full retention re-scan, catching any late/backfilled insert older than the overlap |
| `GRID_REFRESH_MS` | Grid cache tick interval | default `120000` (2 min); each tick is cheap (only rows since the watermark) |
| `APP_RUNS_LOOKBACK_HOURS` | Per-app run-log default window (hours) | default `24`; clamped `1..720` per request. `GET /api/apps/:app/runs`, partition-pruned, not cached |
| `APP_RUNS_LIMIT` | Per-app run-log page size | default `200`; clamped `1..500` per request; keyset-paginated via `before`/`beforeId` |
| `SELF_LOG_ENABLED` | Self-monitoring on/off | default `false` (read-only). `true` writes a heartbeat run via the writer role |
| `SELF_LOG_INTERVAL_MS` | Heartbeat interval | default `300000` (5 min); must align with the `ops-dashboard/heartbeat` cadence in `config/schedules.js` |
| `PG_WRITER_USER` | Writer role | `ops_dashboard_rw` — EXECUTE-only on `ops.log_ops_dashboard_run`; created by `db/setup-writer-role.sql`. No fallback chain |
| `PG_WRITER_PASSWORD` | Writer password | secret; `.env` only |

## Rules

- **Least privilege:** `PGUSER` is `ops_dashboard_ro`. Create it once with
  `db/setup-readonly-role.sql`. Do not point the deployed app at `postgres`.
- **SSL fail-closed:** with `PG_SSLMODE=verify-ca`/`verify-full`, a missing or
  unreadable `PG_SSL_PATH` is a hard error — the app will not silently downgrade to
  unverified TLS. `require` encrypts without CA verification.
- **Fallback chains:** the suite uses `PGHOST || PG_HOST` style fallbacks; keep them.
- **New variables:** when a phase adds one, document its name and purpose here and in
  `.env.example` in the same phase — never just read `process.env.X` undocumented.
- **No secrets in logs:** do not log credential values or full connection strings.
