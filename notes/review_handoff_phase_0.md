# Code Review Handoff — Phase 0: Development Workflow Scaffold

A briefing for an automated reviewer (e.g. Codex). The artifact under review is a
**documentation / process system**, not runtime code — so this review is about
coherence, internal consistency, and whether the durable claims actually match the
codebase and live database. There is no build to run.

---

## 1. What this phase added

A measured, phase-based, prompt-driven development workflow, modeled on
`AppSoloTech/cross-perspective`'s `markdown/` + `prompts/` + `notes/` layout and
adapted to this repo. Goal: make future work on ops-dashboard repeatable and
future-proof.

```
markdown/   FLOW, ARCHITECTURE_PRINCIPLES, PROMPTS, PHASE_TEMPLATE, PHASE_LOG,
            REVIEW_CHECKLIST, ENVIRONMENT, DEPLOYMENT
prompts/    prompt_0 (scaffold) + planned prompt_4..7
notes/      review handoffs/findings (this file is an example)
CLAUDE.md   refreshed to point at the workflow and reflect that v1 is deployed
```

The app itself (v1 slice: read-only Node/Express + pg-promise over
`util.app_run_logs`; job grid, error feed, drill-down) is built and deployed and
was **not** changed this phase.

## 2. Scope of this review

Review commit `8e4d7fb` (Phase 0) — everything under `markdown/`, `prompts/`,
`notes/`, and the `CLAUDE.md` diff. This is docs only.

You may (and should) read the application code and `docs/` to **fact-check** the
claims the workflow docs make — but you are not reviewing the app code for bugs
here (that was Phase 3; see `docs/code-review-handoff.md`).

## 3. How to "run" this review

There's nothing to execute. Instead:

- Read `markdown/FLOW.md` first (it's the entrypoint), then the other `markdown/`
  files and `prompts/*`.
- Cross-check every factual claim against the actual code (`db/queries.js`,
  `db/pg-pool.js`, `server.js`, `lib/*`, `config/schedules.js`,
  `docker-compose.yaml`, `.env.example`, `package.json`) and `docs/`.
- Where a claim is about the live DB, you can verify against
  `util.app_run_logs` if you have read access (least-privilege role
  `ops_dashboard_ro`); otherwise flag it as "claims-live-fact, unverified".

## 4. What I most want scrutinized

These are the areas I'm least sure about. Verify and deepen — don't just restate.

1. **Internal consistency across the docs.** Do the phase numbers, statuses, and
   file names agree across `FLOW.md`, `PROMPTS.md` (Phase Index + Branching), and
   `PHASE_LOG.md`? Does `PHASE_TEMPLATE.md` actually match the shape of the seeded
   `PHASE_LOG.md` entries? Do all cross-references (`markdown/X`, `docs/X`,
   `prompts/X`, `db/setup-readonly-role.sql`) point at files that exist?

2. **Do the durable rules match reality?** `ARCHITECTURE_PRINCIPLES.md` and
   `ENVIRONMENT.md` assert specific facts. Check each against the code/DB:
   - `verbose_log`/`warn_error_logs` are `json` (not jsonb/text); table is
     range-partitioned by month; `inserted_at` indexed DESC.
   - Job = `verbose_log->0->'note'->'argv'->>2`, `data_acquisition` → `(default)`.
   - The app connects as `ops_dashboard_ro` (check `.env.example` default + how
     `db/pg-pool.js` reads it).
   - A single `SELECT` grant on the partitioned **parent** covers all partitions
     (this is asserted as fact — confirm it's true on this PG version).
   - `ENVIRONMENT.md`'s variable list matches what the code actually reads
     (`server.js`, `db/pg-pool.js`) and what `.env.example` documents — no missing
     or phantom vars.

3. **`PHASE_LOG.md` historical accuracy.** Phases 1–3 were reconstructed from
   history. Do the commit SHAs (`f34b90f`, `4d19352`, `f53a256`) and the described
   work match `git log` / the actual diffs? Any claim in those entries that the
   code contradicts?

4. **`DEPLOYMENT.md` runbook correctness.** Do the commands match
   `docker-compose.yaml` (service name `app`, published port, volumes, command)?
   Would the smoke-test sequence actually work as written (e.g. the 503-while-warming
   behavior, the invalid-uuid → 400 check)?

5. **Prompt quality and ordering (`prompts/prompt_4..7`).** For each: is the goal
   singular, are non-goals real guardrails, are the "confirm live" items the right
   ones? Specifically:
   - **prompt_4 (summary table):** it proposes a table in a schema *we own* and a
     writer role. The current `ops_dashboard_ro` cannot create schemas/tables — the
     prompt flags this as a live question. Is that framing adequate, or should the
     prompt be firmer about the privilege/role split? Is the watermark/late-arriving
     -rows concern correctly raised? Does it correctly avoid touching pipeline tables?
   - Are the phases independent where claimed, and is the ordering sensible
     (e.g. does prompt_7's writer-role work overlap prompt_4's, and should that be
     noted as a dependency)?

6. **Secret hygiene.** Confirm **no secret values** (passwords, connection
   strings, cert contents, tokens) appear anywhere in `markdown/`, `prompts/`,
   `notes/`, or the `CLAUDE.md` diff. Variable *names* are fine; values are not.

7. **Is the system right-sized?** This is a relatively small app. Is eight
   `markdown/` docs + a prompt-per-phase proportionate, or is some of it ceremony
   that will rot? Call out anything that adds process cost without payoff, and
   anything genuinely missing (a gap in the loop, a rule that should exist).

## 5. Intentionally out of scope (don't file as findings)

- The app's runtime behavior and the Phase 1–3 code (reviewed already).
- The choice to model on cross-perspective's layout, or to keep domain docs in
  `docs/` while process docs live in `markdown/` (deliberate).
- The decision to deploy host-internal with no auth (decided).
- That prompts 4–7 are unimplemented — they're a roadmap, not pending code.

## 6. Output format requested

Per finding: **Severity** (blocker / high / medium / low / nit) · **File + line**
(`path:line`) · **What & why** · **Suggested fix**.

Priority order: (1) factual claims in the docs that are wrong or contradict the
code/DB, (2) internal inconsistencies and broken cross-references, (3) any secret
leakage, (4) prompt scoping/ordering problems that would cause a bad
implementation phase, (5) right-sizing / missing-process observations. Prefer
fewer, high-confidence findings over a long speculative list.
