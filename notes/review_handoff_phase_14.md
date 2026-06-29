# Code Review Handoff — Phase 14: Connectivity Polish

A briefing for an automated reviewer. Additive, read-only, **no new query or grant**:
a connectivity rollup badge on the grid + a refresh control on the connectivity view.

---

## 1. What this phase added

- `lib/connectivity.js`: pure `rollup(systems)` -> `{ hhm:{offline,total},
  mmb:{offline,total} }` from decorated systems (source + status).
- `server.js`: `/api/connectivity` now includes a `rollup` field (computed via
  `connectivity.rollup`). No new query — same `decorate(...)` result.
- `public/index.html`: the dashboard fetches `/api/connectivity` in `refresh()`
  (resilient — failure keeps last-good, never breaks the dashboard) and shows a
  rollup badge on the **data_acquisition** app group header ("conn: HHM 106 / MMB 33
  off", ERROR-red if any offline), linking to `#connectivity`. The connectivity view
  gains a **refresh** button (re-fetch + re-render, `runReq`-guarded) next to its
  existing "as of" line.
- `test/connectivity.test.js`: +2 (`rollup`). 86 total.

## 2. Scope of this review

Branch `phase-14-connectivity-polish`. Logic: `rollup` in `lib/connectivity.js`. The
rest is the additive endpoint field + the badge/refresh wiring.

## 3. How to verify

- `node --test` → 86 pass.
- Live: `/api/connectivity` includes `rollup` (HHM 106/284, MMB 33/255 offline). On
  the dashboard, the data_acquisition group header shows the conn badge; clicking it
  routes to `#connectivity`; the connectivity view's refresh button re-pulls.

## 4. What I most want scrutinized

1. **Client-side / no backend join.** The badge is derived from the existing
   `/api/connectivity` payload (the `rollup` field), not a new query or a grid/cache
   change. Confirm no new DB work and no grant.
2. **Resilience.** `loadConnRollup()` must never break the dashboard if connectivity
   is slow/failing (it catches and keeps last-good); the badge renders nothing until
   counts exist, then the grid repaints. Confirm a connectivity failure leaves the
   grid fully functional.
3. **Navigation.** The badge is an `<a href="#connectivity">` with
   `stopPropagation()` so clicking it navigates instead of toggling the group's
   collapse. The view refresh reuses `showConnectivity()` (`runReq`-guarded).
4. **Coexistence.** On the data_acquisition header, the rollup status badge, the
   Phase 12 health badge, and this conn badge coexist legibly and stay additive.
5. **`rollup` purity.** DOM-free, tolerant of empty/unknown-source input.

## 5. Out of scope (don't file as findings)

- Per-system history / per-run correlation (`stats.acquisition_history`) — deferred.
- The badge only appearing for data_acquisition (it owns the HHM/MMB sources) and
  only when grouped by app — intentional.
- Auto-refresh on the connectivity view (manual refresh only this phase).

## 6. Output format

Per finding: **Severity** · **`file:line`** · **What & why** · **Suggested fix**.
Priority: (1) a connectivity failure degrading the grid; (2) any backend join/query
sneaking in; (3) the badge toggling collapse instead of navigating.
