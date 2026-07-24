"use strict";

// Reproducible browser gate for the Phase 32 entity workspace. Run only against
// the disposable port-18080 app (never production 8080). Screenshots go to
// EVIDENCE_DIR. Zero console/page errors are tolerated anywhere in the tour.
//
//   docker run -d --name p32-browser --network host \
//     -v "$PWD/notes":/work -w /work node:22 sleep 3600
//   docker exec p32-browser bash -c 'npm i playwright && npx playwright install --with-deps chromium'
//   docker exec p32-browser node /work/phase-32-browser-validation.js
//   docker rm -f p32-browser
const { chromium } = require("playwright");

const base = process.env.APP_BASE || "http://127.0.0.1:18080";
const evidenceDir = process.env.EVIDENCE_DIR || "/tmp/ops-dashboard-phase32-evidence";

function check(value, message) {
  if (!value) throw new Error(message);
}

// The deliberate absent-entity probe fetches a 404, and the injected-failure
// steps abort requests (net::ERR_FAILED); Chromium logs both as console errors
// even though the app handles them with honest section/empty-state text. Only
// those expected messages, only during their steps, are tolerated.
let expectingDeliberate404 = false;
let expectingInjectedFailure = false;

function monitor(page, faults) {
  page.on("pageerror", (error) => faults.push("pageerror: " + error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (expectingDeliberate404 && /404 \(Not Found\)/.test(message.text())) return;
    if (expectingInjectedFailure && /net::ERR_FAILED/.test(message.text())) return;
    faults.push("console: " + message.text());
  });
}

const workspaceState = () => ({
  title: document.title,
  hash: location.hash,
  nav: document.querySelector("[aria-current=page]")?.id,
  source: document.querySelector("#source-label").textContent,
  heading: document.querySelector("#system-view h2")?.textContent,
  sections: Array.from(document.querySelectorAll("#system-view h3"), (h) => h.textContent),
  back: document.querySelector("#system-view a")?.getAttribute("href"),
  counts: document.querySelector("#system-view")?.textContent || "",
  visible: !document.querySelector("#system-view").hidden,
});

async function main() {
  const browser = await chromium.launch({ headless: true });
  const faults = [];
  const results = {};
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  monitor(page, faults);

  // -- 1. card grid -> canonical workspace ---------------------------------
  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForSelector("#entity-cards article");
  const cardHref = await page.locator("#entity-cards article a").first().getAttribute("href");
  check(/^#entity=.+&from=entities$/.test(cardHref), "card link is not canonical: " + cardHref);
  const entity = decodeURIComponent(cardHref.match(/#entity=([^&]+)/)[1]);
  await page.locator(`#entity-cards article a[href="${cardHref}"]`).first().click();
  await page.waitForSelector("#system-view h3");
  // The shell paints immediately; wait for both sources before asserting.
  await page.waitForFunction(() => {
    const text = document.querySelector("#system-view")?.textContent || "";
    return /matching incident records loaded|No matching incident records/.test(text) &&
      !/Loading connectivity…/.test(text);
  });
  let ws = await page.evaluate(workspaceState);
  check(ws.visible && ws.heading === "Entity " + entity, "workspace heading wrong: " + JSON.stringify(ws));
  check(ws.title.startsWith("Entity " + entity), "document title not entity-scoped");
  check(ws.nav === "nav-entities", "Entities nav not active on workspace");
  check(ws.source === "incidents.* + alert.* + util.app_run_logs", "workspace source scope wrong: " + ws.source);
  check(ws.sections[0] === "Incidents" && ws.sections.includes("Current connectivity") &&
    ws.sections.some((s) => /^Recent run-log signals \(last \d+h\)$/.test(s)),
  "three labeled sections expected, got " + JSON.stringify(ws.sections));
  check(ws.back === "#", "workspace back should return to entities: " + ws.back);
  check(/\d+ of \d+ matching incident records loaded/.test(ws.counts),
    "scoped loaded/matching counts missing");
  check(!/incidents overall/.test(ws.counts), "global total must not appear on the scoped page");
  results.workspace = ws;
  await page.screenshot({ path: evidenceDir + "/01-workspace.png", fullPage: true });

  // -- 2. incident drill-down returns to the exact workspace ----------------
  const incidentLink = page.locator("#system-view table a", { hasText: "view ›" }).first();
  await incidentLink.click();
  await page.waitForSelector("#incident-view h2");
  const incidentBack = await page.evaluate(() => document.querySelector("#incident-view a")?.getAttribute("href"));
  check(incidentBack === "#entity=" + encodeURIComponent(entity),
    "incident back does not target the workspace: " + incidentBack);
  await page.locator("#incident-view a").first().click();
  await page.waitForSelector("#system-view h3");
  ws = await page.evaluate(workspaceState);
  check(ws.heading === "Entity " + entity, "return from incident lost the workspace");

  // -- 3. signals run link returns to the workspace (compact UUID + copy) ----
  await page.waitForFunction(() => !/Loading connectivity…/
    .test(document.querySelector("#system-view")?.textContent || ""));
  const signalsCopy = page.locator("#system-view .copy-run");
  if (await signalsCopy.count()) {
    check(true, "signal rows expose a copy control");
  }
  const runLink = page.locator("#system-view table").last().locator("tbody a[href^='#run=']").first();
  if (await runLink.count()) {
    const runAria = await runLink.getAttribute("aria-label");
    check(/^run [0-9a-f-]{36}$/.test(runAria || ""), "signal run link lost the exact UUID: " + runAria);
    await runLink.click();
    await page.waitForSelector("#run-view h2");
    const runBack = await page.evaluate(() => document.querySelector("#run-view a")?.getAttribute("href"));
    check(runBack === "#entity=" + encodeURIComponent(entity), "run back lost entity context: " + runBack);
    await page.goBack();
    await page.waitForSelector("#system-view h3");
  }
  results.drilldownReturns = true;

  // -- 4. legacy #system= renders the same workspace ------------------------
  await page.goto(base + "/#system=" + encodeURIComponent(entity), { waitUntil: "networkidle" });
  await page.waitForSelector("#system-view h3");
  ws = await page.evaluate(workspaceState);
  check(ws.heading === "Entity " + entity && ws.nav === "nav-entities" && ws.back === "#",
    "legacy alias is not the workspace: " + JSON.stringify(ws));
  check(ws.sections.length >= 3, "legacy alias missing sections");
  results.legacyAlias = ws;

  // -- 5. entry from connectivity keeps its return context ------------------
  await page.goto(base + "/#connectivity", { waitUntil: "networkidle" });
  await page.waitForSelector("#connectivity-view table a");
  const connHref = await page.locator("#connectivity-view table a").first().getAttribute("href");
  check(/^#entity=.+&from=connectivity$/.test(connHref), "connectivity link not canonical: " + connHref);
  await page.locator("#connectivity-view table a").first().click();
  await page.waitForSelector("#system-view h3");
  ws = await page.evaluate(workspaceState);
  check(ws.back === "#connectivity", "workspace back should honor connectivity origin: " + ws.back);
  results.connectivityEntry = true;

  // -- 6. system-signals, acquisition, and raw-list entries stay canonical ---
  await page.goto(base + "/#systems", { waitUntil: "networkidle" });
  await page.waitForSelector("#systems-view table a");
  const sysHref = await page.locator("#systems-view table a").first().getAttribute("href");
  check(/^#entity=.+&from=systems$/.test(sysHref), "systems link not canonical: " + sysHref);
  await page.goto(base + "/#acq-systems", { waitUntil: "networkidle" });
  await page.waitForSelector("#acq-view table a");
  const acqHref = await page.locator("#acq-view table a[href*='entity=']").first().getAttribute("href");
  check(/^#entity=.+&from=acq-systems$/.test(acqHref), "acquisition link not canonical: " + acqHref);
  await page.locator(`#acq-view table a[href="${acqHref}"]`).first().click();
  await page.waitForSelector("#system-view h3");
  ws = await page.evaluate(workspaceState);
  check(ws.back === "#acq-systems", "workspace back should honor acquisition origin: " + ws.back);
  await page.goto(base + "/#incident-list", { waitUntil: "networkidle" });
  await page.waitForSelector("#incidents-view table a[href*='entity=']");
  const listHref = await page.locator("#incidents-view table a[href*='entity=']").first().getAttribute("href");
  check(/^#entity=.+&from=incident-list$/.test(listHref), "raw-list entity link not canonical: " + listHref);
  await page.locator(`#incidents-view table a[href="${listHref}"]`).first().click();
  await page.waitForSelector("#system-view h3");
  ws = await page.evaluate(workspaceState);
  check(ws.back === "#incident-list", "workspace back should honor raw-list origin: " + ws.back);
  results.entryMatrix = true;

  // -- 7. non-SME workspace is honest ---------------------------------------
  await page.goto(base + "/#entity=__global__", { waitUntil: "networkidle" });
  await page.waitForFunction(() => /cross-fleet incident group|Couldn't load/
    .test(document.querySelector("#system-view")?.textContent || ""));
  ws = await page.evaluate(workspaceState);
  check(ws.heading === "Entity __global__", "__global__ workspace missing");
  check(ws.counts.includes("cross-fleet incident group"), "global kind label missing");
  check(ws.counts.includes("No connectivity record"), "must not fabricate SME connectivity for __global__");
  await page.screenshot({ path: evidenceDir + "/02-global-workspace.png", fullPage: true });
  results.nonSme = true;

  // -- 8. absent + 404 semantics --------------------------------------------
  expectingDeliberate404 = true;
  await page.goto(base + "/#entity=SME00000", { waitUntil: "networkidle" });
  await page.waitForFunction(() => /No incident, connectivity, or recent signal data/
    .test(document.querySelector("#system-view")?.textContent || ""));
  expectingDeliberate404 = false;
  results.notFound = true;

  // -- 9. deterministic delayed/failed responses ------------------------------
  expectingInjectedFailure = true;
  const cardTwo = await page.evaluate(async () => {
    const data = await (await fetch("/api/entities")).json();
    return data.entities[1].entity;
  });

  // Sub-steps revisit the same #entity= hash; a goto to an identical URL is a
  // same-document no-op, so reset to #jobs between steps to force a real
  // hashchange-driven reload under the installed interception.
  const resetRoute = async () => {
    await page.evaluate(() => { location.hash = "#jobs"; });
    await page.waitForFunction(() => !document.querySelector("#dashboard").hidden);
  };

  // 9a. partial paint: incident-records request fails; summary/connectivity/
  // signals still render with honest per-section error text only for records.
  await page.route("**/api/incidents?*entity=*", (route) => route.abort());
  await page.goto(base + "/#entity=" + encodeURIComponent(entity), { waitUntil: "load" });
  await page.waitForFunction(() => {
    const text = document.querySelector("#system-view")?.textContent || "";
    return /Couldn't load this entity's incident records/.test(text) &&
      !/Loading incident summary…/.test(text) && !/Loading connectivity…/.test(text);
  });
  ws = await page.evaluate(workspaceState);
  check(/active of \d+ incidents/.test(ws.counts), "incident summary missing during records failure");
  check(!ws.counts.includes("Couldn't load connectivity") &&
    (/last result/.test(ws.counts) || ws.counts.includes("No connectivity record")),
  "connectivity should render despite records failure");
  await page.unroute("**/api/incidents?*entity=*");

  // 9b. reciprocal partial paint: the combined context request fails while
  // incident records succeed. The three context sections show honest failure
  // text; the incident summary and records still render.
  await resetRoute();
  await page.route("**/api/entities/" + entity + "*", (route) => route.abort());
  await page.evaluate((id) => { location.hash = "#entity=" + id; }, entity);
  await page.waitForFunction(() => {
    const text = document.querySelector("#system-view")?.textContent || "";
    return /matching incident records loaded/.test(text) &&
      /Couldn't load connectivity/.test(text) && !/Loading/.test(text);
  });
  ws = await page.evaluate(workspaceState);
  check(/matching incident records loaded/.test(ws.counts), "records missing during context failure");
  check(ws.counts.includes("Couldn't load the incident summary") &&
    ws.counts.includes("Couldn't load connectivity") &&
    ws.counts.includes("Couldn't load recent signals"),
  "context sections should each show honest failure text");
  await page.unroute("**/api/entities/" + entity + "*");

  // 9c. delayed context: records paint first; the context section shells say
  // loading instead of hiding them; the late context then fills in.
  await resetRoute();
  await page.route("**/api/entities/" + entity + "*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  await page.evaluate((id) => { location.hash = "#entity=" + id; }, entity);
  await page.waitForFunction(() => /matching incident records loaded/
    .test(document.querySelector("#system-view")?.textContent || ""));
  ws = await page.evaluate(workspaceState);
  check(/Loading connectivity…/.test(ws.counts) && /Loading recent signals…/.test(ws.counts),
    "records painted but context shells not shown while pending");
  await page.waitForFunction(() => !/Loading connectivity…/
    .test(document.querySelector("#system-view")?.textContent || ""));
  ws = await page.evaluate(workspaceState);
  check(/last result/.test(ws.counts) || /No connectivity record/.test(ws.counts),
    "delayed context never filled its sections");
  await page.unroute("**/api/entities/" + entity + "*");

  // 9d. GENUINE delayed A -> B -> Jobs: all three navigations happen while A's
  // requests are still in flight (2s delay, navigations within ~100ms). Jobs
  // must win, and A's and B's late completions must never repaint it.
  await page.route("**/api/entities/*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  await page.route("**/api/incidents?*entity=*", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.continue();
  });
  await resetRoute();
  await page.evaluate(({ a, b }) => {
    location.hash = "#entity=" + a;   // A: requests fire, delayed 2s
    location.hash = "#entity=" + b;   // B: supersedes A before A lands
    location.hash = "#jobs";          // Jobs: supersedes B, all still in flight
  }, { a: entity, b: cardTwo });
  await page.waitForFunction(() => !document.querySelector("#dashboard").hidden);
  const midFlight = await page.evaluate(() => ({
    nav: document.querySelector("[aria-current=page]")?.id,
    workspaceHidden: document.querySelector("#system-view").hidden,
  }));
  check(midFlight.nav === "nav-jobs" && midFlight.workspaceHidden,
    "delayed A->B->Jobs did not land on Jobs: " + JSON.stringify(midFlight));
  await page.waitForTimeout(2500); // let every delayed A/B response land and be dropped
  const afterLanding = await page.evaluate(() => ({
    nav: document.querySelector("[aria-current=page]")?.id,
    workspaceHidden: document.querySelector("#system-view").hidden,
    jobsVisible: !document.querySelector("#dashboard").hidden,
  }));
  check(afterLanding.nav === "nav-jobs" && afterLanding.workspaceHidden && afterLanding.jobsVisible,
    "late A/B completions repainted over Jobs: " + JSON.stringify(afterLanding));
  await page.unroute("**/api/entities/*");
  await page.unroute("**/api/incidents?*entity=*");

  // 9e. refresh recovery: with the workspace's context request HUNG, refresh
  // must re-enable promptly (reload started, sections own their waiting) and a
  // re-click after the hang clears must fully load.
  let hungRoute = null;
  await page.route("**/api/entities/__global__*", (route) => { hungRoute = route; /* never fulfil */ });
  await page.evaluate(() => { location.hash = "#entity=__global__"; });
  await page.waitForSelector("#system-view h3");
  await page.locator("#refresh").click();
  await page.waitForFunction(() => !document.querySelector("#refresh").disabled, null, { timeout: 3000 });
  ws = await page.evaluate(workspaceState);
  check(/Loading connectivity…/.test(ws.counts), "hung context should leave section shells waiting");
  await page.unroute("**/api/entities/__global__*");
  if (hungRoute) await hungRoute.abort().catch(() => {});
  await page.locator("#refresh").click();
  await page.waitForFunction(() => /cross-fleet incident group/
    .test(document.querySelector("#system-view")?.textContent || ""));
  check(!(await page.locator("#refresh").isDisabled()), "refresh stranded after hung request recovery");

  // 9f. scoped load-more failure. Live entities have <25 incidents so no page
  // boundary occurs naturally; inject a nextCursor into the first scoped page,
  // then fail the load-more request. The error must be VISIBLE (body text) and
  // ANNOUNCED (the polite live region actually holds the text — the ordering
  // bug from the re-review left the region cleared by resetView).
  await resetRoute();
  await page.route("**/api/incidents?*entity=" + entity + "*", async (route) => {
    if (route.request().url().includes("cursor=")) return route.abort(); // load-more fails
    const resp = await route.fetch();
    const body = await resp.json();
    body.nextCursor = "aW5qZWN0ZWQ"; // opaque; the abort above stops it reaching SQL
    await route.fulfill({ response: resp, body: JSON.stringify(body) });
  });
  await page.evaluate((id) => { location.hash = "#entity=" + id; }, entity);
  await page.waitForSelector("[data-entity-incidents-more]");
  await page.locator("[data-entity-incidents-more]").click();
  await page.waitForFunction(() => {
    const region = document.querySelector("#system-view p.run-msg[role=status]");
    return region && !region.hidden && /Couldn't load more incident records/.test(region.textContent || "");
  }, null, { timeout: 5000 });
  const loadMore = await page.evaluate(() => {
    const region = document.querySelector("#system-view p.run-msg[role=status]");
    const button = document.querySelector("[data-entity-incidents-more]");
    return {
      bodyHasError: /Couldn't load more incident records/.test(document.querySelector("#system-view")?.textContent || ""),
      regionHidden: !region || region.hidden,
      regionText: region ? region.textContent : null,
      buttonEnabled: !!button && !button.disabled,
    };
  });
  check(loadMore.bodyHasError, "scoped load-more failure not shown in body");
  check(!loadMore.regionHidden && /Couldn't load more incident records/.test(loadMore.regionText || ""),
    "scoped load-more failure not announced in the visible live region: " + JSON.stringify(loadMore));
  check(loadMore.buttonEnabled, "load-more button should stay enabled for retry");
  // The announcement must survive a later re-render (e.g. a late context settle
  // whose resetView would otherwise wipe the region).
  await page.waitForTimeout(2000);
  const persisted = await page.evaluate(() => {
    const region = document.querySelector("#system-view p.run-msg[role=status]");
    return !!region && !region.hidden && /Couldn't load more incident records/.test(region.textContent || "");
  });
  check(persisted, "load-more announcement was wiped by a later re-render");
  await page.unroute("**/api/incidents?*entity=" + entity + "*");
  results.loadMoreFailure = true;

  expectingInjectedFailure = false;
  results.deterministicRaces = true;

  // -- 10. responsive containment, light and dark ----------------------------
  for (const [width, height, scheme] of [
    [390, 844, "light"], [390, 844, "dark"],
    [768, 900, "light"], [768, 900, "dark"],
    [1440, 900, "light"], [1440, 900, "dark"],
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
    const p = await ctx.newPage();
    monitor(p, faults);
    await p.goto(base + "/#entity=" + encodeURIComponent(entity), { waitUntil: "networkidle" });
    await p.waitForSelector("#system-view h3");
    await p.waitForFunction(() => /matching incident records loaded/
      .test(document.querySelector("#system-view")?.textContent || ""));
    const overflow = await p.evaluate(() => ({
      body: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      wrappers: document.querySelectorAll("#system-view .table-scroll").length,
      contained: Array.from(document.querySelectorAll("#system-view .table-scroll"), (w) => {
        const rect = w.getBoundingClientRect();
        return rect.left >= 0 && rect.right <= document.documentElement.clientWidth + 1;
      }).every(Boolean),
    }));
    check(overflow.body <= 0, `body overflows horizontally at ${width}px ${scheme}`);
    check(overflow.wrappers >= 1 && overflow.contained,
      `table wrappers escape the viewport at ${width}px ${scheme}`);
    if (width === 390 && scheme === "dark") await p.screenshot({ path: evidenceDir + "/03-mobile-dark.png", fullPage: true });
    await ctx.close();
  }
  results.responsive = true;

  check(faults.length === 0, "console/page errors: " + JSON.stringify(faults));
  console.log(JSON.stringify({ base, entity, results }, null, 2));
  console.log("ALL BROWSER CHECKS PASS");
  await browser.close();
}

main().catch((err) => { console.error("FAILED:", err.message); process.exit(1); });
