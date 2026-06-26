# Phase Log Entry Template

Copy this template into `markdown/PHASE_LOG.md` (newest entry at the top) after a
phase is implemented, validated, and ready to commit.

---

# Phase X — Short Phase Name

Date:
YYYY-MM-DD

Status:
Completed / Deferred / Partially completed

Prompt:
`prompts/prompt_X_name.txt`

Git Commit:
Pending / commit SHA

Review Artifacts:

- Review handoff: `notes/review_handoff_phase_X.md`
- Review results: `notes/review_results_phase_X.md`

## Goals

- Goal 1
- Goal 2

## Built

- Change 1
- Change 2

## Schema Facts Confirmed (live DB)

- Fact verified against `util.app_run_logs` this phase (e.g. column type, index,
  partition behavior, which apps write). "None" if the phase touched no queries.

## Important Decisions

### Decision Name

Decision:

Reason:

Tradeoff:

## Architecture Notes

- Read-only / least-privilege impact:
- Query / partition-pruning impact:
- Performance (request-path latency) impact:
- Security impact:
- Deployment impact:
- API / response-shape compatibility impact:

## Validation

Commands run:

```bash
# command
```

Results:

- Passed:
- Failed:
- Not run:

Manual / smoke tests:

- Test 1
- Test 2

## Review Notes

Source:

- `notes/review_results_phase_X.md`

Critical issues:

- None / issue list

Accepted fixes:

- None / fix list

Deferred findings:

- None / deferred list with reason

## Problems Encountered

- Problem:
  Resolution:

## Follow-Up Tasks

- Task 1

## Commit Readiness

- Requirements implemented:
- Read-only / least-privilege rules hold:
- Time-windowed queries partition-pruned:
- Schema assumptions confirmed live:
- Review findings addressed or deferred:
- Validation recorded:
- Ready to commit:
