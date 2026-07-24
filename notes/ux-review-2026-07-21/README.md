# UX review screenshots — 2026-07-21

Captured from the deployed app (`http://localhost:8080`, live staging data: 26 jobs,
528 incidents, 539 connectivity rows) via headless Chromium at 1440×900 unless noted.
Files with a `b` suffix are full-page captures; their pixel height is itself a finding.

| File | View | Why it was captured |
|---|---|---|
| `01-dashboard-top.png` | Dashboard (grouped by app) | Default landing view |
| `01b-dashboard-full.png` | Dashboard, full page (~15,500px tall) | Error feed renders 100 full stack traces inline |
| `02-dashboard-flat.png` | Dashboard, group-by None | Flat grid layout |
| `02b-dashboard-search.png` | Dashboard, search "hhm" | Filter + "showing N" header state |
| `03-da-expanded.png` | data_acquisition 12h-runs expansion | SUCCESS summary row above an almost all-ERROR sub-run list |
| `04-run-drilldown.png` | Run drill-down (PHILIPS_CT, ERROR) | Detail column repeats ids as JSON |
| `04b-run-drilldown-full.png` | Run drill-down, full page | 130-event timeline length |
| `05-connectivity.png` | Connectivity | 539 rows, all-pink table, empty Error/Phase columns, "20179h" data age |
| `06-systems.png` | Systems with recent issues | 210 rows, every row red-tinted |
| `07-system-detail.png` | System SME01139 | Cross-app breakdown |
| `08-incidents.png` | Incidents | 528 rows, wall of identical high/open/rsync_io_timeout |
| `09-incident-detail.png` | Incident #17100 | Assessment/tiles — the good parts |
| `09b-incident-detail-full.png` | Incident detail, full page (~24,000px) | 100 near-identical event rows |
| `10-appruns.png` | Run log — hhm_rpp_ge | Active filter styled as disabled; all rows tinted |
| `11-acq-systems.png` | Acquisition by system | mmb rows lack modality/manufacturer |
| `12-mobile-dashboard.png` | Dashboard at 390×844 | Controls wrap awkwardly; tables force page h-scroll |
| `13-dark-chip-active.png` | Dashboard, dark, ERROR chip active | Chip active-ring only visible in dark mode |
| `14-dark-incidents.png` | Incidents, dark | Stale "showing 12" grid meta persists in header on other views |

Findings write-up + reviewer briefing: `notes/review_handoff_ux_review_2026-07-21.md`.
`tour.js` in this folder is the Playwright script that produced these shots (see the
handoff §1 for how to re-run it).
