# Review Checklist

The quality gate run before any phase commits. Walk it explicitly; record the
outcome in the phase's `PHASE_LOG.md` entry. (For a deep external review, generate
a handoff in `notes/` modeled on `docs/code-review-handoff.md`.)

## Phase Scope

- Did the change stay within the current phase prompt?
- Were the prompt's non-goals respected?
- Were unrelated UI, query, dependency, or deployment changes avoided?
- Was `markdown/PROMPTS.md` status updated if it changed?
- Was a `markdown/PHASE_LOG.md` entry added after implementation and validation?

## Read-Only & Least Privilege

- Does the change avoid any write/DDL to pipeline tables?
- If self-logging was touched, are writes limited to `app_name = "ops-dashboard"`?
- Does the app still connect as `ops_dashboard_ro` (not a superuser)?
- Could any new code path write to the DB even in principle?

## Data Contract & Queries

- Were schema assumptions confirmed against the **live DB** this phase?
- Does every time-windowed query filter `inserted_at` so partitions prune?
  (Confirm with `EXPLAIN` when a query is new or changed.)
- Is JSON parsing defensive (malformed `dt` → null, never a failed cast that
  blanks the grid; negative durations clamped)?
- Do the SQL rules and the `lib/runs.js` JS rules still agree?
- If `docs/logging-schema.md` was contradicted, was the doc updated?

## Performance

- Is heavy `verbose_log` detoast kept off the request path?
- Do request-path handlers return well under a second?
- If a query got heavier, is it on a background/snapshot path, and is the cost noted?

## Security & Secrets

- Is `.env` still uncommitted? Are only variable names (no values) in docs?
- Are error responses generic to clients, with details logged server-side?
- Is external input validated before it reaches Postgres (e.g. uuid shape)?
- Are passwords, connection strings, and cert contents absent from docs/commits?

## Validation

- Did `node --test` pass (or are failures documented)?
- Were focused tests added/updated for changed behavior?
- Was a live smoke test run if routing, queries, credentials, or deploy changed?
  (`/healthz`, grid warm, an endpoint sample — see `DEPLOYMENT.md`.)

## House Style & Compatibility

- Does the change match the suite's conventions (pg-promise, env fallbacks, Docker)?
- Were existing API response shapes preserved where practical?
- Does `node index.js <job>` dispatch still hold for any new entrypoint?

## Commit Decision

- Safe to commit?
- Needs fixes first?
- Any roadmap status to revalidate before the next phase?
