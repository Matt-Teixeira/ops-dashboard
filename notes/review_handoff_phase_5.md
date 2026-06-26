# Code Review Handoff — Phase 5: Run Drill-Down UI

A briefing for an automated reviewer (e.g. Codex). The artifact is a **frontend
change** to a static, no-build page. The review is about correctness of the
client logic, XSS/injection safety, accuracy of user-facing copy, and consistency
with the rest of the app — not backend behavior (none changed).

---

## 1. What this phase added

A frontend-only run drill-down in `public/index.html`: a hash router keeps the
job grid + error feed as the default view and renders a per-run event timeline
into a `#run-view` section over the existing `GET /api/runs/:run_id`.

- Entry points: the grid run-id cell links with the row's `inserted_at`; error-feed
  rows are clickable and pass the event `dt`. Both become
  `/api/runs/:id?inserted_at=<hint>` (the hint prunes the partitioned query).
- Timeline: run header (app/job, status badge, timing, event count) + an event
  table; WARN/ERROR rows tinted; all log-derived text via `textContent`.
- Large runs: initial render capped at 500 events with a "show all N" reveal.
- Clean 400 / 404 / fetch-error copy.

No endpoints, queries, DB, or credentials changed.

## 2. Scope of this review

Commits `11ce769` + `d60d39f` on `main`. Effectively all of the change is in
`public/index.html` (plus `PHASE_LOG.md` / `PROMPTS.md` doc updates). The phase
prompt is `prompts/prompt_5_run_drilldown_ui.txt`.

## 3. How to verify

The container serves the static file from a bind mount, so it's already live on
`:8080` — no restart needed. Useful checks:

- Open the dashboard, click a grid run-id and an error-feed row; confirm each
  timeline loads and the network request carries `?inserted_at=...`.
- Deep-link directly to `#run=<uuid>&at=<iso>` (cold load, dashboard never
  rendered first) and confirm it works and that "← back" then loads the grid.
- A made-up uuid (valid shape, no row) and a malformed id — confirm the 400/404
  copy, no stack traces.
- A large `data_acquisition` run — confirm the 500-cap + reveal.

## 4. Constraints to confirm still hold

- **Frontend only** — no backend/query/credential change (the hint uses what the
  existing responses already provide: grid `inserted_at`, error-feed event `dt`).
- **No `innerHTML`/HTML interpolation of log data** — every log-derived string
  (func, tag, note, err_msg, type) must reach the DOM via `textContent`/`cell`.
- **Read-only** — the view only fetches and renders.

## 5. What I most want scrutinized

I read the diff and flagged these candidates — verify, judge severity, and find
what I missed rather than just restating.

1. **404 copy accuracy (`showRun`).** On 404 it says "Run not found — it may have
   aged out of the 30-day window." But 30 days is the *grid cache* retention, not
   the DB's — `util.app_run_logs` retains many months of partitions, and the
   drill-down reads the table directly. A run older than 30 days still exists and
   (with a correct hint) still loads. Is this message misleading? When does a 404
   actually happen given the entry points always pass a near-exact hint?

2. **No unhinted fallback on 404.** The hinted query matches `inserted_at` within
   ±1h of the hint. The two live entry points always pass a hint within minutes,
   so they're fine — but a stale/hand-edited deep-link `at` that's >1h off would
   404 a run that `/api/runs/:id` (no hint) would find via full scan. Worth a
   fallback retry without the hint, or is it not worth the partition cost?

3. **Status rule now lives in a third place.** `runStatus(events)` in the page
   re-derives ERROR>WARN>SUCCESS from `verbose_log`, alongside the SQL
   (`db/queries.js`) and `lib/runs.js`. It should agree (warn_error_logs is a
   subset of verbose_log), but confirm it does, and weigh the drift risk of a
   third copy of the rule.

4. **Injection safety, end to end.** Confirm there is no path where a log value
   becomes markup or a script. Note `cell` uses `textContent`; the type→CSS-class
   mapping uses a whitelist in the timeline (`TYPE_CLASS`) but the *error feed*
   still sets `className = "badge " + e.type` from the raw value — is that purely
   cosmetic (class only, no HTML) or is there any vector?

5. **Keyboard/a11y of clickable error rows.** Grid links are `<a>`; error-feed
   rows are a `<tr>` with a click handler (no `role`/`tabindex`/keyboard
   activation). Acceptable for an internal tool, or worth a focusable control?

6. **Router edge cases.** `route()` runs on load and on `hashchange`; "← back"
   sets `#`. Check: a `run=` hash on cold load (dashboard never loaded →
   `dashboardLoaded` stays false until back), repeated identical hashes, and
   whether the dashboard ever needs a re-fetch after returning (it doesn't
   re-load if already loaded — stale data until manual refresh).

## 6. Out of scope (don't file as findings)

- Backend behavior (`/api/runs/:run_id`, `/api/errors`) — unchanged and reviewed
  in earlier phases.
- The no-build / static-vanilla-JS approach and the in-page hash router (decided).
- The absence of periodic auto-refresh (pre-existing; the page never auto-polled).

## 7. Output format

Per finding: **Severity** (blocker / high / medium / low / nit) · **`file:line`**
· **What & why** (how to trigger/observe) · **Suggested fix**. Priority:
(1) injection/safety, (2) correctness of routing/hint/status logic, (3) misleading
user copy, (4) a11y/polish. Prefer fewer, high-confidence findings.
