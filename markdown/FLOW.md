# Development Flow

This project uses a **measured, phase-based workflow**. Each unit of work is a
small, reviewable, revertible *phase* driven by a structured prompt. The system
exists so that any contributor — human or AI agent — produces consistent,
verifiable results and so the project stays repeatable as it grows.

| File | Purpose |
| ---- | ------- |
| `markdown/ARCHITECTURE_PRINCIPLES.md` | Durable, non-negotiable rules for this app |
| `markdown/PROMPTS.md` | Phase roadmap, status, and prompt quality rules |
| `markdown/REVIEW_CHECKLIST.md` | Quality gate run before every phase commits |
| `markdown/PHASE_LOG.md` | Durable memory of decisions, validation, and outcomes |
| `markdown/PHASE_TEMPLATE.md` | Template for new phase log entries |
| `markdown/ENVIRONMENT.md` | Environment variable rules (names only, no secrets) |
| `markdown/DEPLOYMENT.md` | Docker deploy + smoke-test runbook |
| `prompts/prompt_X_*.txt` | Phase-specific implementation prompts |
| `notes/` | Review handoffs, findings, and temporary investigation notes |

The domain/context docs this app reads from already live in `docs/` and
`CLAUDE.md`. The `markdown/` system references them; it does not duplicate them.

---

# Core Philosophy

`ops-dashboard` is a **read-only** monitoring service over the shared pipeline
log table `util.app_run_logs`. The workflow priorities are:

- never write to pipeline data; stay read-only and least-privilege
- verify assumptions against the **live database** before building query logic
- keep heavy work (large JSON detoast) off the request path
- match the existing `/opt/apps` suite's house style instead of inventing new conventions
- keep each phase small enough to review and revert
- keep secrets (`.env`, passwords, connection strings) out of docs and commits

When in doubt, prefer the safe, smaller, more reviewable option. See the
Decision Rule in `ARCHITECTURE_PRINCIPLES.md`.

---

# Primary Reference Documents

Before beginning any phase, review:

1. `CLAUDE.md` — project orientation and working agreement
2. `markdown/ARCHITECTURE_PRINCIPLES.md` — durable rules
3. `docs/logging-schema.md` — the data contract (verify against live DB)
4. `docs/infra-conventions.md` — suite house style to copy
5. `markdown/ENVIRONMENT.md` — env var rules
6. `markdown/DEPLOYMENT.md` — deploy + smoke runbook
7. `markdown/PROMPTS.md` — roadmap and the current phase prompt
8. `markdown/REVIEW_CHECKLIST.md` — the quality gate
9. recent entries in `markdown/PHASE_LOG.md`

These files are part of the development system, not incidental notes.

---

# Phase Execution Flow

## Step 1 — Review Context

- read the reference documents above
- run `git status --short`
- confirm the current phase goal and **non-goals**
- identify the commands that validate the phase
- identify anything the phase touches that reads the DB, changes deploy, or
  relies on a schema assumption that must be confirmed live

## Step 2 — Confirm Assumptions Against The Live DB

This is the rule that makes this project trustworthy. Before writing or changing
query logic, confirm the relevant facts against the live `util.app_run_logs`
(column types, `json` vs `jsonb`, partitioning, indexes, which apps actually
write, the shape of `verbose_log` events). The schema doc is reconstructed from
app code, not DDL — treat it as a hypothesis until verified.

If reality differs from the docs, **update the docs in the same phase** and note
it in `PHASE_LOG.md`.

## Step 3 — Revalidate Roadmap Alignment

If direction has changed, decide whether the phase prompt should be implemented
as written, revised, split, deferred, or discarded. Record the decision in
`PHASE_LOG.md` and update `PROMPTS.md`.

## Step 4 — Create Or Checkout Phase Branch

One branch per phase unless the developer chooses otherwise.

```txt
phase-X-short-name      # e.g. phase-4-summary-table
```

Run `git status --short` before switching. Do not carry unrelated uncommitted
work into a phase branch.

## Step 5 — Implementation

- stay within the current phase prompt
- preserve working behavior unless the phase says otherwise
- keep every time-windowed query **partition-pruned** (`WHERE inserted_at ...`)
- keep heavy JSON work off the request path
- connect to the DB as the least-privilege read-only role, never a superuser
- add or update tests when behavior changes
- update phase docs when scope or status changes
- keep `.env` values out of docs and commits

## Step 6 — Validation

At minimum:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test      # unit tests
# plus a live smoke test if routing/queries/deploy changed — see DEPLOYMENT.md
```

Broaden validation when a phase touches DB credentials, query shape, the grid
snapshot, partitioning assumptions, or deployment.

## Step 7 — Review And Log

- run through `markdown/REVIEW_CHECKLIST.md`
- add a phase entry to `markdown/PHASE_LOG.md` (use `PHASE_TEMPLATE.md`)
- update `markdown/PROMPTS.md` status
- store any review handoff/results in `notes/`

## Step 8 — Commit Readiness

A phase is ready to commit only when implementation matches the prompt, the
read-only and partition-pruning rules still hold, validation results are
recorded, and the docs reflect the actual state.
