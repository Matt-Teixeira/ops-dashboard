# Logging Schema — the data contract

This is the data the dashboard reads. Reconstructed from the shared logger code in
the existing apps (`utils/logger/log.js`, `utils/logger/enums.js`, and the pg-helpers
ColumnSet). **It is not from a DDL file — verify column types against the live DB
before depending on them.**

Shared logger lives at `utils/logger/` in each app and exports:
`addLogEvent`, `writeLogEvents`, `dbInsertLogEvents`, `makeAppRunLog`, `destroyAppRunLog`.

## 1. Database: `util.app_run_logs`

One row is written **per run** (not per event). The full event array is stored as a
JSON blob.

| Column | Type (likely) | Meaning |
|---|---|---|
| `app_name` | text | From `process.env.APP_NAME` (e.g. `"reports"`, `"hhm_rpp_siemens"`). |
| `run_id` | uuid | UUIDv4 generated at run start (`uuidv4()`). |
| `verbose_log` | jsonb or text | JSON-stringified array of **all** log events for the run. |
| `warn_error_logs` | jsonb or text | JSON-stringified array of only the WARN/ERROR events (pre-filtered). |

ColumnSet definition (from `part-source-pipeline/utils/db/sql/pg-helpers.js`):

```js
app_run_logs: new pgp.helpers.ColumnSet(
  ['app_name', 'run_id', 'verbose_log', 'warn_error_logs'],
  { table: pg_tables.util.app_run_logs }   // -> util.app_run_logs
)
```

Insert (from `*/utils/logger/log.js`, `dbInsertLogEvents`):

```js
const query = pgp.helpers.insert(app_run_log, pg_column_sets.util.app_run_logs);
await db.none(query);
```

### ⚠️ Open questions to confirm against the live DB

- Is there a **timestamp column** (created_at / inserted_at)? If not, run time must
  come from the first/last event `dt` *inside* `verbose_log` — slower to query. This
  materially affects dashboard query design.
- Are `verbose_log` / `warn_error_logs` typed `jsonb` (queryable with `->`/`@>`) or
  plain `text` (must parse app-side)?
- Is there a primary key / index on `app_name`? on `run_id`?
- Row volume & retention — how big is this table? Any partitioning?
- Do **all** in-scope apps write here, or do some only write files? (Confirm
  `data_acquisition`, which has an extended logger.)

## 2. Files: `/opt/run-logs/<app>/`

Path pattern:

```
/opt/run-logs/<APP_NAME>/<APP_NAME>-log.<LOGGER>.<RUN_ID>.json
# e.g. /opt/run-logs/reports/reports-log.dev.e6b2a0e8-...-c2e3e491e48d.json
```

In dev, files may instead land at `./utils/logger/<APP_NAME>-log.<LOGGER>.<RUN_ID>.json`.
`<LOGGER>` is an env-driven label (e.g. `dev`). File content is a single JSON array of
event objects (same objects stored in `verbose_log`).

## 3. Event object shape

Each element of the `verbose_log` / file array:

```json
{
  "run_id": "2e9fc35d-306e-4e6f-a48a-9c6f73fe8ae4",
  "dt": "2026-06-09T18:23:34.716Z",
  "type": "INFO",
  "func": "on_boot",
  "tag": "CALL",
  "note": { "LOGGER": "dev", "argv": ["/usr/local/bin/node", "/workspace/index.js", "SIEMENS_MRI"] },
  "err_msg": "...present only when type=ERROR (uses error.stack if available)..."
}
```

- `dt` is ISO-8601 UTC. The **earliest** `dt` ≈ run start, **latest** `dt` ≈ run end →
  duration. (Confirm; `data_acquisition` also has explicit timers — see below.)
- The first event is typically `func: "on_boot"`, `tag: "CALL"`, and its
  `note.argv[2]` is the **job name** (e.g. `SIEMENS_MRI`). Use it to group runs by job.

## 4. Enums

From `utils/logger/enums.js` (identical across apps).

**Type (severity):**

| Code | Value |
|---|---|
| `I` | `INFO` |
| `W` | `WARN` |
| `E` | `ERROR` |

**Tag (event category):**

| Code | Value |
|---|---|
| `cal` | `CALL` |
| `det` | `DETAILS` |
| `cat` | `CATCH` |
| `seq` | `SEQUENCE HALTED` |
| `qaf` | `QA FAILURE` |

A run's **status** for the dashboard can be derived as:
`ERROR` if `warn_error_logs` contains any `type: "ERROR"`; else `WARN` if it contains
any `type: "WARN"`; else `SUCCESS`. (Confirm `SEQUENCE HALTED` / `QA FAILURE` tags map
to a WARN/ERROR type — they should, but verify.)

## 5. Run id

UUIDv4 via the `uuid` package (`uuidv4()`). Note: some apps also depend on `short-uuid`
elsewhere, but run ids in `app_run_logs` are full UUIDv4.

## 6. `data_acquisition` extras

Its logger (`utils/logger/log.js`) additionally provides:

- `startTimer(run_log, label)` / `endTimer(run_log, label, extra_note)` → emits events
  carrying `duration_ms`.
- `addRunSummary(run_log)` → an aggregate event with `wall_clock_ms`, `event_count`,
  and per-subnet timer buckets.

If present, these give precise per-run duration without diffing `dt` values — worth
special-casing for the `data_acquisition` app card.
