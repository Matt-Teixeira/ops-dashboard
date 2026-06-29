# Apps Suite — what the dashboard monitors

The dashboard provides visibility into the apps under `/opt/apps`. It's a medical-
imaging equipment telemetry operation: data flows from GE/Philips/Siemens modalities
→ parsed → PostgreSQL → surfaced via Monday.com, email reports, and Acumatica ERP sync.

All apps are cron-driven, run via `docker compose`, write structured logs to
`util.app_run_logs` and `/opt/run-logs/<app>/`, and connect to the same PostgreSQL.

## Inventory

| App | Role | Notable jobs (npm scripts) | Notes |
|---|---|---|---|
| `data_acquisition` | rsync/pull orchestrator for all vendors; spawns a job per system | `ge_ct`, `ge_cv`, `ge_mri`, `philips_ct/cv/mri`, `philips_mri_mmb`, `siemens_ct/cv/mri` | Runs every 15–30 min. Has timers/run-summary helpers in its logger. Log dir 1.6 GB+ (unbounded). |
| `hhm_rpp_ge` | Parse GE CT/CV/MRI equipment logs → DB | `ge_ct`, `ge_cv`, `ge_mri` | Per-vendor parser. Empty README. |
| `hhm_rpp_philips` | Parse Philips logs (multi-monitor MRI: 5 monitors/RMMUs/log jobs) | `philips_ct`, `philips_cv`, `philips_mri_monitor_1..5`, `..._rmmu_1..5`, `..._log_1..5`, `file_dt`, `delete_old_files` | Memory-tuned (`--max-old-space-size=4096`). Log dir 1.4 GB+. Leftover debug `console.log`. |
| `hhm_rpp_siemens` | Parse Siemens logs (Win7 vs Win10 formats) | `siemens_ct`, `siemens_mri`, `siemens_cv` | 24h file rollover logic. Empty README. |
| `acumatica_sync` | Acumatica ERP OData → PG `acumatica_systems` table | single `start` job | Mature, clean. Uses raw `pg`. |
| `monday` | Acumatica diff → Monday.com boards + Teams notifications | `equipment_rtt`, `process_new_additions`, `group_coverage`, `sync_missing_data`, `rtt_hhm_drift`, `rtt_feed_change_report`, `export_csv` | Well-documented (`PROCESS-FLOW.md`). Registry-map dispatch. |
| `part-source-pipeline` | HCA parts/inventory → PG → CSV over SFTP | `hca_sync`, `inv_feed_sync`, `send_csv_sftp` | Uses `ssh2-sftp-client`. |
| `reports` | 20+ parameterized email reports (helium level/pressure, alerts, issue trackers) | `he_level_value`, `he_pressure_value`, `issue_tracker`, `mmb_all_issue_tracker`, `hhm_all_issue_tracker`, … (24 scripts) | Nodemailer + Handlebars over Office365 SMTP. |
| `pg_manage_v2` | Azure→local PG schema/data migration | `schema_migration` | Mostly bash scripts; one-off/manual. Probably **out of scope** for live monitoring. |
| `redis-admin` | 4 Redis instances (PROD/STAGING/dev) via compose | — | Infra only; config bind-mounts are broken (running on defaults). Out of scope unless you add Redis health. |
| `imprivata-poc` | Imprivata SFTP proof-of-concept (Python) | — | Blocked PoC. Out of scope. |

## Implications for the dashboard

- **In scope (have run logs):** `data_acquisition`, `hhm_rpp_ge/philips/siemens`,
  `acumatica_sync`, `monday`, `part-source-pipeline`, `reports`. These all write to
  `util.app_run_logs` — they're the core of the dashboard.
- **Likely out of scope (no run-log stream / not job-shaped):** `pg_manage_v2`,
  `redis-admin`, `imprivata-poc`.
- **Job identity:** a "job" is `(app_name, job_name)` where `job_name` is the npm
  script / `argv[2]` (e.g. `philips_mri_monitor_3`). The run log's first event
  (`func: "on_boot"`, `tag: "CALL"`) carries `note.argv`, which contains the job
  name — useful for grouping runs by job. Confirm this holds for every app.
- **Cron cadence is not in the DB.** To detect "stale/missing" jobs you'll need the
  expected schedule per job (from each app's cron file / docs). Consider a small
  config map in this repo listing expected cadence per `(app, job)`.
- **Volume:** several apps run every 15 min × many systems → `util.app_run_logs`
  could be large. Plan queries around indexes on `app_name` and a timestamp; confirm
  whether the table has a created-at column or whether timing comes from the first/last
  event's `dt` inside `verbose_log`.
- **Per-system connectivity (`data_acquisition`):** the grid buckets all of
  `data_acquisition` into one `(default)` row, hiding which equipment systems are
  offline. `data_acquisition` also upserts the latest per-`system_id` connectivity
  state into `alert.offline_hhm_conn` (SSH telemetry) and `alert.offline_mmb_conn`
  (Philips MRI rsync). The Phase 10 connectivity panel reads these (read-only). See
  [`docs/connectivity-schema.md`](./connectivity-schema.md).
