# Code Review Handoff — Phase 6: Real Schedule Cadences

A briefing for an automated reviewer (e.g. Codex). This phase is mostly **config +
small pure logic + an additive API/UI surface**. The review is about cadence
*accuracy* (do the numbers match reality), the staleness coverage logic, and
whether any job can falsely read healthy or falsely read stale.

---

## 1. What this phase added

- `config/schedules.js`: placeholder cadences → confirmed values with per-entry
  provenance (cron line + observed median gap). Added the 15 Philips variants
  (`MONITOR/_RMMU/_LOG _1..5`), dropped the false `SIEMENS_CV` entry (unscheduled →
  left unknown), retuned `data_acquisition/(default)`, and recorded the wall-clock
  crons (monday/acumatica/part-source) as **commented** future entries.
- `lib/staleness.js`: added pure `isConfigured()` and `coverage()` helpers;
  `evaluate()` unchanged (still everyMin-only; cron parsing deliberately deferred).
- `server.js`: additive `coverage` field on `/api/jobs/latest` + an unknown-count
  in the refresh log line.
- `public/index.html`: a "N cadence unknown" header note and a muted `? CADENCE`
  badge so a job with no configured cadence (`stale === null`) never reads green.
- `test/staleness.test.js`: +7 tests (26 total).

No DB writes, no schema change, no cron evaluator. Source of truth for cadences:
`data_acquisition/docs/cron-jobs.txt` and `hhm_rpp_philips/docs/cron.txt`.
Reality-check query: `notes/schedule-cadence-probe.sql`.

### Already addressed pre-review (verify, don't re-find)

- **`data_acquisition/(default)` false-STALE budget.** The original
  `{everyMin:5, graceMin:5}` (10-min budget) was sized on p90 (2.8 min) but sat
  *below* the max normal inter-run gap. Re-measured over 7 days: p90 2.8 / **p99
  10.1 / max 12.3 min** — so the aggregate bucket would intermittently flap STALE.
  Fixed in a follow-up commit to `{everyMin:20, graceMin:10}` (30-min budget,
  ~2.4x max), with the comment corrected to justify against max, not p90. Tests
  updated (26/26). Please **verify** the new threshold and reasoning rather than
  re-deriving it.

## 2. Scope of this review

Phase 6 commits `234574d` + `1d76a31`, plus the budget-fix follow-up, on `main`.
Verify cadence claims against the cron files and the live DB (read-only as
`ops_dashboard_ro`).

## 3. What I most want scrutinized

1. **Cadence provenance accuracy.** Spot-check that each entry's cited cron line is
   real and attributed to the right app. In particular: `cron-jobs.txt` contains a
   "HHM DATA ACQUISITION" block that runs `npm run ge_ct` etc. under
   *data_acquisition* (bucketed as `(default)`) AND a separate "HHM RPP" block
   (`18,48`, `cd hhm_rpp_ge`) that is the *hhm_rpp_ge* parser. The config must cite
   the **HHM RPP** line for `hhm_rpp_ge/GE_*`, not the acquisition one. Confirm
   ge/siemens cite `18,48` and philips cites `15,45`, matching observed 30.0 min.

2. **Coverage logic — can anything read green when it shouldn't?**
   `coverage()` is fed `jobs` from the live grid in `server.js` (good — dynamic). Confirm:
   a newly-logging app with no config entry surfaces as `unknown` (not configured,
   not green); the UI shows `? CADENCE` for `stale === null` and **nothing** for a
   healthy `stale === false`; and the header/log counts match the grid.

3. **Dormant-but-configured jobs (`SIEMENS_CT`/`SIEMENS_MRI`).** They're configured
   at 30 min and ~17 days idle, so they read STALE — technically correct. Is a
   permanent STALE the right product behavior for equipment that may be retired, or
   should there be a "dormant/retired" distinction? (Design question, low.)

4. **`(default)` semantics.** `everyMin` for an aggregate bucket is a silence budget,
   not a real interval — the split into `everyMin + graceMin` is arbitrary (only the
   sum, the budget, matters). Is the comment clear that this is a stall budget?

5. **Deferred entries.** The commented wall-clock crons guess job-name casing
   (`EQUIPMENT_RTT`, etc.) — acceptable since they're inert until those apps log and
   the casing is confirmed then. Confirm they can't accidentally activate.

## 4. Out of scope (don't file as findings)

- The decision to defer cron-string parsing (everyMin suffices for every current
  grid job; documented).
- The staleness *mechanism* (evaluate → grid `stale` → UI badge) — built/reviewed
  in Phases 4–5; this phase only feeds it data + coverage.
- Backend query/cache behavior — unchanged.

## 5. Output format

Per finding: **Severity** (blocker / high / medium / low / nit) · **`file:line`** ·
**What & why** (how to trigger/observe) · **Suggested fix**. Priority:
(1) anything that makes a job read falsely healthy or falsely stale, (2) cadence
values that don't match the cron/observed data, (3) coverage/UI correctness,
(4) clarity. Prefer fewer, high-confidence findings.
