# Code Review Handoff — Phases 17–19 (branch `phase-19-incidents-view`)

A briefing for an automated reviewer (Codex). Read this first, then review the code
under the scope below. Goal: a **correctness + security + design** review of the three
unreviewed phases on this branch. (Phases up to 16 were Codex-reviewed in earlier
rounds; 17 and 18 were only self-reviewed, so they are in scope here alongside 19.)

---

## 1. What this app is (30-second version)

`ops-dashboard` is a **read-only** Node/Express + pg-promise web service giving
centralized visibility into ~10 cron-driven medical-imaging data-pipeline apps under
`/opt/apps`. It reads the shared log table `util.app_run_logs` (+ three small derived
surfaces) and renders a job grid, error feed, run drill-down, connectivity panel, and
per-system views. It never writes pipeline data; it connects as the least-privilege
role `ops_dashboard_ro`. Context: `CLAUDE.md`, `markdown/ARCHITECTURE_PRINCIPLES.md`,
`docs/logging-schema.md`.

New this branch: it also consumes the `incidents` schema **produced by a separate
writer app** (`/opt/apps/incident-engine`) — the suite's error firehose collapsed into
classified, severity-assessed incidents. The dashboard only ever SELECTs it.

---

## 2. Scope of this review

Branch `phase-19-incidents-view`, i.e. `main..HEAD` — four commits, three phases:

| Commit | Phase | What |
|---|---|---|
| `9eb0495` | 17 | Per-equipment-system correlation view (`/api/systems`, `/api/systems/:id`, `#systems`/`#system=<id>`) |
| `e23896b` | 18 | data_acquisition run-log **job type** (bounded `verbose_log` LATERAL, additive `jobType` field) |
| `98679f4` | 19 | **Incidents view** (4th read surface, `/api/incidents`, `/api/incidents/:id`, `#incidents`/`#incident=<id>`) |
| `9c2b93b` | 19 | Review close-out: schema-owner verification recorded; capped-events header precision fix |

Files to review (everything the diff touches except `markdown/`):

```
db/setup-readonly-role.sql   incidents grant block (fail-closed REVOKE→GRANT→DO-verify)
db/queries.js                SYSTEMS_LATEST/SYSTEM_DETAIL (P17), buildAppRunsSql (P18),
                             INCIDENTS_* / INCIDENT_* (P19)
lib/systems.js               P17 pure shaping
lib/app-runs.js              P18 formatJobType + shapePage jobType
lib/incidents.js             P19 shaping/normalizers
server.js                    routes for all three phases
public/index.html            all three phases' views + router/CSS additions
test/systems.test.js  test/app-runs.test.js  test/incidents.test.js
.env.example                 SYSTEMS_WINDOW_HOURS
```

**Out of scope — don't relitigate:** the stack (Node/Express/pg-promise/vanilla JS —
deliberate, matches the suite); incident-engine's internals, schema design, or
classification logic (separately governed and reviewed in that repo); the markdown
process docs; the pre-existing code around the diff (review interactions with it, not
its own quality).

---

## 3. How to run / verify it

`node` is **not** on the host — Docker only. The app is deployed and running on this
host (port 8080) with all grants applied, so live checks work immediately.

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test     # 112/112 expected
docker exec ops-dashboard-app-1 wget -qO- localhost:8080/api/systems | head -c 300
docker exec ops-dashboard-app-1 wget -qO- "localhost:8080/api/apps/data_acquisition/runs?windowHours=12&limit=50" | head -c 300
docker exec ops-dashboard-app-1 wget -qO- localhost:8080/api/incidents | head -c 400
docker exec ops-dashboard-app-1 wget -qO- localhost:8080/api/incidents/17190 | head -c 400
```

Boundary re-check (should hold exactly):

```sql
SET ROLE ops_dashboard_ro;
SELECT count(*) FROM incidents.incidents;      -- works (~530, drifts)
INSERT INTO incidents.incidents(fingerprint,entity,category_source)
  VALUES ('x','y','classifier');               -- MUST fail: permission denied
SELECT count(*) FROM incidents.pipeline_state; -- MUST fail: permission denied
```

---

## 4. Hard constraints the code must respect (try to falsify each)

1. **Read-only, least-privilege.** No code path writes any DB table. The role's grants
   are exactly: SELECT on `util.app_run_logs`, 2× `alert.*`, `stats.acquisition_history`,
   and (new) `incidents.incidents` + `incidents.error_events` — each non-`util` block
   fail-closed (REVOKE → GRANT → DO-verify). Verify the new incidents block RAISEs on
   any unexpected effective privilege, mirrors the alert/stats blocks, and that
   `pipeline_state` is not granted.
2. **Partition pruning.** Every time-windowed query over `util.app_run_logs` filters
   `inserted_at` (P17's two SQL consts, P18's variants). `incidents.*` is NOT
   partitioned — bounded by index + LIMIT instead; that's the owner's DDL, not a
   violation.
3. **The Performance Rule and its one sanctioned exception.** `verbose_log` detoast
   stays off the request path EXCEPT P18's job-type LATERAL: enabled only for
   `app === "data_acquisition"`, only ≤50 rows/page, evaluated after ORDER BY+LIMIT.
   The lean SQL variant must be byte-for-byte free of `verbose_log` (a test enforces
   this — check the test actually proves it).
4. **Bound params only.** No string-built SQL. External inputs are gated before
   Postgres: `SYSTEM_ID_RE`, `INCIDENT_ID_RE`, the P13-style enum filters, P19's
   shape-gated normalizers (`normalizeSeverity/State/Category`). Try to find a path
   where user input reaches SQL uninterpolated-unvalidated.
5. **The provenance rule (P19).** `category_source` travels DB→API→DOM untouched, and
   EVERY place a category renders branches on it: `oracle` → dashed muted badge +
   tooltip, never a plain diagnosed category. Live proof case: incident 17190
   (category `rsync_io_timeout`/oracle; its own ~668 events are `unknown` +
   `no_new_data`). Check the list cell AND the detail header.
6. **XSS discipline.** All dynamic text via `textContent`/`createTextNode` — no
   innerHTML with data. Incident `sample_message`, event messages, and assessment
   reasons are attacker-influencable strings from other apps' logs; verify none is
   interpreted as HTML.
7. **Request-path budget.** All new endpoints return well under a second (worst
   measured: incidents drill-down ~95ms warm / 1.7s cold on a 45k-event incident —
   accepted, composite index pending engine-side; see §6).

---

## 5. Known weak spots — please scrutinize these specifically

Confirm severity, find what the author missed, propose concrete fixes. Don't restate.

**Phase 17**
1. `SYSTEMS_LATEST_SQL` / `SYSTEM_DETAIL_SQL` unnest `warn_error_logs` with
   `json_array_elements` per row over the window. Is the `LIMIT $2` (500) enough of a
   bound if a window is pathological? Is `(array_agg(run_id ORDER BY inserted_at DESC))[1]`
   a correct "latest run" under ties?
2. `sme` extraction is `NULLIF(e->'note'->>'sme','')` — events with a non-object `note`
   or with `sme` under a different key silently drop out. Acceptable? Any crash path?

**Phase 18**
3. The LATERAL's "evaluated after LIMIT" claim rests on the planner. Is there a plan
   shape (e.g. a different partition layout, stats drift) where Postgres evaluates the
   LATERAL for more rows than the page? Would a `LATERAL ... LIMIT 1` inside a
   subquery-in-SELECT be strictly safer?
4. `formatJobType` treats `"null"`/`"undefined"` strings as absent. Any other producer
   sentinel (`"none"`, `"N/A"`) in live data that leaks through as a bogus label?

**Phase 19**
5. `GET /api/incidents` runs rollup + list in one `Promise.all` — two statements, no
   shared snapshot. A row committed between them skews tiles vs list momentarily.
   Accepted as harmless; confirm there's no worse inconsistency (e.g. filters counting
   against a different total).
6. `entityCell` links any `SME*` entity to `#system=<id>`; Phase 17's view only shows
   the last 24h window, so an old incident's system can render an empty detail.
   Mislead or fine?
7. `shapeAssessment` guards jsonb shapes, but `confidence` uses `Number(r.confidence)`
   — NUMERIC arrives as a string from pg-promise; `Number("0.30")` is fine, but check
   NaN paths render as "—" not "NaN".
8. The events header math uses `occurrenceCount` as the denominator ("newest 100 of
   668") — but `error_events` retention could someday hold fewer rows than
   `occurrence_count` counts. Is the label still honest in that case?
9. Detail fetch is two sequential queries (incident, then events by its
   fingerprint/entity). TOCTOU: the incident row could be upserted between them —
   confirm the worst case is just "slightly newer events", never a mismatch.

---

## 6. What is intentionally deferred (don't file as bugs)

- **`(fingerprint, entity, dt DESC)` composite index** on `incidents.error_events` —
  accepted with evidence and owned by incident-engine (this repo's query needs no
  change when it lands). The 1.7s cold worst case is known and bounded.
- **Job-type column in the full run-log view** (`#appruns=data_acquisition`) — the
  endpoint returns it; the dropdown shows it; the full view doesn't yet (~10-line
  follow-up).
- **`acknowledged`/`suppressed` human transitions** — the dashboard stays read-only;
  any write path is a future incident-engine-governed feature.
- **Auth** — none; host-internal by decision.
- **Onboarding suite-health overview + legend** — open roadmap.
- **Old roadmap phases 18/20 (category trends / insights feed)** — superseded by
  incident-engine; documented in `markdown/PROMPTS.md`.

---

## 7. Output format requested

Per finding: **Severity** (blocker / high / medium / low / nit) · **`path:line`** ·
**What & why** (concrete, with how to trigger/observe) · **Suggested fix** (minimal,
house style).

Priority order: (1) anything violating read-only/least-privilege or letting input
reach SQL unvalidated; (2) the fail-closed grant block's completeness; (3) the
provenance rule actually holding everywhere a category renders; (4) P18's bounded
detoast claim; (5) correctness of shaping/normalizers/self-check math; then everything
else. Bias toward fewer, high-confidence findings over a long speculative list.

---

*Prior review context:* the schema owner (incident-engine) already verified the
integration end-to-end — boundary exact, proof case 17190 confirmed, index follow-up
accepted (see `markdown/PHASE_LOG.md` Phase 19 → Review Notes). This Codex round is
the general code review the workflow requires on top of that domain review.
