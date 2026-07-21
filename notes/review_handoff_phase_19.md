# Review handoff — Phase 19: Incidents View

Branch: `phase-19-incidents-view` (single commit on top of Phase 18 `e23896b`).
Prompt: `prompts/prompt_19_incidents_view.txt`. Producer contract:
`/opt/apps/incident-engine/notes/ops_dashboard_integration_brief.md` +
`/opt/apps/incident-engine/docs/incidents-schema.md`.

## What this phase is

Read-only consumption of incident-engine's `incidents` schema: a fourth fail-closed read
surface for `ops_dashboard_ro`, two new endpoints (`/api/incidents`,
`/api/incidents/:id`), a pure shaping lib, and `#incidents` / `#incident=<id>` views.
incident-engine is untouched.

## Files

- `db/setup-readonly-role.sql` — incidents grant block (REVOKE → GRANT → DO-verify;
  `pipeline_state` NOT granted)
- `db/queries.js` — 4 SQL consts + wrappers (rollup / list / detail / events)
- `lib/incidents.js`, `test/incidents.test.js` — shaping + normalizers + SQL text contract
- `server.js` — 2 routes
- `public/index.html` — CSS badges/tiles, nav, 2 sections, 2 views, route branches
- `markdown/` — ARCHITECTURE_PRINCIPLES (4th surface + identity), PROMPTS (rows 18/19,
  superseded roadmap), PHASE_LOG

## Hard constraints to try to falsify

1. **Read-only:** no code path writes the incidents schema (or anything else). The role
   provably cannot (INSERT + pipeline_state SELECT denied — re-run the checks).
2. **Provenance rule:** every category rendering carries `category_source`; an
   `oracle`-provenance category must never present as a diagnosis (list cell, detail
   header, anywhere). Test case: incident 17190 (oracle `rsync_io_timeout` over
   `unknown` events).
3. **Bound params only:** severity/state/category normalize to 'all' or a shape-gated
   value; `:id` is regex-gated before `::bigint`. Nothing user-supplied is interpolated.
4. **Self-check:** the tile numbers and the list come from the same response; tiles must
   equal a hand-run severity×state GROUP BY at the same moment.
5. **Bounded drill-down:** events query is `(fingerprint, entity)` + `dt DESC` +
   `LIMIT ≤ 500`. (Review outcome: true worst case is a 45,509-event incident —
   1,748ms cold via the bitmap path; the owner validated and accepted a
   `(fingerprint, entity, dt DESC)` composite → 3.4ms, to be ADDed engine-side.)

## Known weak spots — please scrutinize

- ~~The drill-down's worst case (chatty incidents)~~ — resolved in review: owner-side
  composite index accepted (see PHASE_LOG Review Notes).
- `entityCell` links any `SME*` entity to `#system=` — a system with no recent window
  events shows an empty Phase 17 detail (correct but potentially surprising).
- The rollup and list are two queries in one `Promise.all` — a row committed between
  them could skew tiles vs list by one momentarily (accepted; both re-fetch on filter).

## Validation already run

112/112 unit tests; boundary read-ok/write-denied; live tiles == GROUP BY
(209/269/50 · 361/30/137 at 2026-07-21 ~12:29); filter, bad-input, 400/404 paths;
EXPLAIN list (~1.4ms) + events (~95ms worst case) as `ops_dashboard_ro`.
