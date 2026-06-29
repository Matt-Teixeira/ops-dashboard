# Code Review Handoff — Phase 16: data_acquisition Inline Run Expansion

A briefing for an automated reviewer. **Frontend-only** (`public/index.html`): an
inline, lazy, capped peek at `data_acquisition`'s recent run_ids under its grid row,
reusing the Phase 11 run-log endpoint. No backend, query, grant, cache, or restart.

---

## 1. What this phase added

`data_acquisition` collapses to one `(default)` grid row (no argv job). This adds a
"▸ 12h runs" toggle on that row (when grouped by app) that lazily fetches
`/api/apps/data_acquisition/runs?windowHours=12&limit=50` and renders the runs as
indented sub-rows (Status / Last run / Age / Issues / Run id → drill-down with the
`at=` hint; Duration "—" since the run-log is lean). If the window held more than the
cap (`nextBefore` set), a "see all in run log ›" sub-row links to
`#appruns=data_acquisition`. Module state `daRuns = {expanded, loading, error, runs,
more}`; re-fetches fresh on each expand; resilient (failure → inline note).

## 2. Scope of this review

Branch `phase-16-da-inline-runs`. All changes in `public/index.html`
(`jobRow` toggle, `renderGrid` sub-row injection, `toggleDaRuns`/`loadDaRuns`/
`daSubRows`/`subRunRow`, + CSS). No logic modules changed (tests stay 91/91).

## 3. How to verify

- `node --test` → 91 pass; inline script `node --check` clean.
- Live (frontend bind-mounted; no restart): group by App, click "▸ 12h runs" on the
  data_acquisition row → ~50 newest run_ids from the last 12h render as sub-rows; each
  Run id drills down (with the `at=` hint); "see all in run log ›" opens the full
  run-log; collapsing hides them; other rows and the grid request are unaffected.
- `/api/apps/data_acquisition/runs?windowHours=12&limit=50` returns 50 + `nextBefore`.

## 4. What I most want scrutinized

1. **Additive + scoped.** Only the data_acquisition `(default)` row (grouped by app)
   gets the toggle; the existing row + its badges/links are untouched; no other app is
   affected.
2. **Lazy + resilient.** The fetch happens only on expand; a failure/empty shows an
   inline note and never breaks the grid render.
3. **Reuse, no new surface.** It calls the existing Phase 11 endpoint — no new query,
   grant, or cache change; sub-rows drill down with the `inserted_at` hint; "see all"
   links to the run-log when capped.
4. **Safety.** Run text rendered via `textContent`; sub-rows are injected only when the
   data_acquisition group is expanded (Phase 8 collapse hides the parent row and thus
   the sub-rows, since they're appended after it within the group).

## 5. Out of scope (don't file as findings)

- The peek being capped (50) and data_acquisition-specific — intentional; the run-log
  is the full paginated/filterable view.
- Duration shown as "—" (the run-log query is `warn_error_logs`-only by design).
- Sub-rows not auto-refreshing on the Phase 9 interval (they refresh on next expand).

## 6. Output format

Per finding: **Severity** · **`file:line`** · **What & why** · **Suggested fix**.
Priority: (1) the expansion breaking the grid render on fetch failure; (2) leaking to
other apps' rows; (3) a missing drill-down hint or innerHTML use.
