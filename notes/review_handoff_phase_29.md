# Code Review Handoff — Phase 29 UX Fix Round

A briefing for an independent reviewer. Review only the Phase 29 delta that closes the
findings in `notes/review_ux_implementation_phases_20_28_claude_findings_2026-07-21.md`.
Do not change code. Return findings and a commit-readiness verdict.

## Scope and baseline

- Repository: `/opt/apps/ops-dashboard`, branch `main`.
- The Phase 20–29 series is still uncommitted relative to baseline `547999bf`.
- Isolate the Phase 29 work conceptually by reviewing the cited finding against the
  current implementation and the Phase 29 files below. The prior Phase 20–28 review
  already cleared connectivity, incident ordering/paging SQL, read-only safety, and
  injection concerns; do not relitigate those without a concrete regression.
- Port 8080 was not restarted. Use a disposable worktree service on 18080 for live UI.

Phase 29 files:

```
lib/incidents.js                 cursor-domain validation
public/feed-view.js              defensive lossless note text
public/grid-view.js              sort migration / chip disabled rule
public/index.html                CSS, controller, focus, disclosure, copy, chrome
public/routes.js                 readability only
public/time-view.js              readability only
test/feed-view.test.js
test/grid-view.test.js
test/incidents.test.js
test/routes.test.js
test/time-view.test.js
notes/phase-29-browser-validation.js
markdown/PHASE_LOG.md
markdown/PROMPTS.md
```

## Finding-to-fix checklist

Return `CLOSED`, `PARTIAL`, or `NOT CLOSED` for each:

- **H1:** refresh button resets unconditionally after a captured handler settles.
- **M1:** `.table-scroll` has a bounded vertical scroll context; sticky header geometry
  and narrow horizontal containment are both measured.
- **M2/M3:** active ring is blue in light/dark; active zero-count chip/tile remains
  operable while inactive zero controls stay disabled.
- **M4/L7:** note arrays/objects/falsy/distinct promoted values survive; unusual direct
  values do not throw or become accidental `[object Object]`.
- **M5/M6/L8:** warm-up/error writes are route-owned, only one retry chain exists,
  dashboard summary restores immediately, and hidden dashboard links retain dashboard
  return context.
- **M7:** three sequential incident category changes restore focus after each response;
  error paths leave the persistent control usable.
- **M8:** cursor accepts only `YYYY-MM-DDTHH:mm:ss.sssZ` with year 0001–9999 and
  `0..9223372036854775807` id. Invalid values return generic 400 before SQL; valid full
  paging is unchanged.
- **M9:** data_acquisition inline runs use a native button with aria-expanded and Space.
- **L1–L5/L10/L11:** valid named regions; persistent polite statuses; progressive
  focus/open state; removed Age migration; “incidents overall” wording; readable helper
  formatting; exact UUID copy and honest manual fallback.
- **Deferred by prompt:** L6 systems truncation API metadata and L9 time-rounding policy.
  F7 remains partial by deliberate product decision.

## High-risk questions

1. Can any valid PostgreSQL incident timestamp or server-emitted cursor now be rejected,
   or any JS-accepted value still cause a cast-time 500? Check year zero, extended
   years, invalid calendar days, null timestamps, and bigint max/overflow.
2. Does the max-height solution create inaccessible nested scrolling, trap focus, or
   materially degrade short tables? Verify sticky headers during wrapper scrolling,
   not page screenshots alone.
3. Can overlapping refresh, warm retry, route change, or filter requests repaint the
   wrong chrome or strand the refresh button?
4. Do persistent live-region nodes stay in the DOM across renders and receive their
   message after insertion? Are announcements too noisy or hidden incorrectly?
5. Does the note serializer preserve producer JSON faithfully without exposing HTML,
   looping on cycles, or dropping a distinct `system_id`/`sme` value?
6. Does UUID copy work in secure Clipboard contexts and provide a truthful selectable
   fallback when Clipboard is absent/rejected?

## Reproduction

Unit suite:

```bash
docker run --rm -v "$PWD":/w -w /w node:lts node --test
# Expected: 146/146
```

Start an isolated app exactly as described in
`notes/review_handoff_ux_implementation_phases_20_28_2026-07-21.md`, using host port
18080. Run `notes/phase-29-browser-validation.js` from a disposable Playwright
container with `APP_BASE` pointing to that isolated app. The script checks all nine
routes, races, sticky geometry, keyboard/focus behavior, responsive containment, and
UUID copy/fallback, and writes screenshots only to `/tmp` in the browser container.

Recorded result: 146 tests pass; browser output includes sticky `scrollTop=300` and
header delta 0, enabled refresh, three-category focus traversal, all nine active nav
parents, UUID copy/fallback, and exactly two warm-up requests. A live valid cursor walk
returned 529 unique rows over six pages; signed-year, RFC-1123, overflow-id, and year-0
cursors returned the same generic 400.

## Constraints / output

- No application edits, deployment, commit, or push.
- Preserve read-only/parameterized behavior and all review artifacts.
- Findings first: severity, `path:line`, concrete trigger/impact, smallest fix.
- Then the per-finding closure checklist and `ready to commit` / `needs fixes` verdict.
- Bias toward high-confidence regressions introduced by Phase 29; do not file deferred
  L6/L9 or the intentional F7 policy as new omissions.
