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

// The deliberate absent-entity probe fetches a 404, which Chromium logs as a
// console error even though the app handles it with honest empty-state text.
// Only that expected message, only during that step, is tolerated.
let expectingDeliberate404 = false;

function monitor(page, faults) {
  page.on("pageerror", (error) => faults.push("pageerror: " + error.message));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (expectingDeliberate404 && /404 \(Not Found\)/.test(message.text())) return;
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

  // -- 3. signals run link returns to the workspace -------------------------
  const runLink = page.locator("#system-view table").last().locator("a", { hasText: "view ›" }).first();
  if (await runLink.count()) {
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

  // -- 6. system-signals list entry stays canonical --------------------------
  await page.goto(base + "/#systems", { waitUntil: "networkidle" });
  await page.waitForSelector("#systems-view table a");
  const sysHref = await page.locator("#systems-view table a").first().getAttribute("href");
  check(/^#entity=.+&from=systems$/.test(sysHref), "systems link not canonical: " + sysHref);

  // -- 7. non-SME workspace is honest ---------------------------------------
  await page.goto(base + "/#entity=__global__", { waitUntil: "networkidle" });
  await page.waitForSelector("#system-view h3");
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

  // -- 9. races: A -> B -> jobs with no mixed paint, refresh never strands ---
  const cardTwo = await page.evaluate(async () => {
    const data = await (await fetch("/api/entities")).json();
    return data.entities[1].entity;
  });
  await page.goto(base + "/#entity=" + encodeURIComponent(entity), { waitUntil: "domcontentloaded" });
  await page.evaluate((next) => { location.hash = "#entity=" + next; }, cardTwo);
  await page.waitForSelector("#system-view h3");
  ws = await page.evaluate(workspaceState);
  check(ws.heading === "Entity " + cardTwo && !ws.counts.includes(entity),
    "rapid A->B left mixed entity content: " + ws.heading);
  await page.evaluate(() => { location.hash = "#jobs"; });
  await page.waitForFunction(() => !document.querySelector("#dashboard").hidden);
  const jobsChrome = await page.evaluate(() => ({
    meta: document.querySelector("#meta").textContent,
    nav: document.querySelector("[aria-current=page]")?.id,
    workspaceHidden: document.querySelector("#system-view").hidden,
  }));
  check(jobsChrome.nav === "nav-jobs" && jobsChrome.workspaceHidden,
    "entity -> jobs race left stale view/chrome: " + JSON.stringify(jobsChrome));
  await page.locator("#refresh").click();
  await page.evaluate(() => { location.hash = "#entity=" + "__global__"; });
  await page.waitForSelector("#system-view h3");
  await page.waitForFunction(() => !document.querySelector("#refresh").disabled);
  results.races = true;

  // -- 10. responsive containment, light and dark ----------------------------
  for (const [width, height, scheme] of [[390, 844, "light"], [390, 844, "dark"], [768, 900, "dark"], [1440, 900, "dark"]]) {
    const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: scheme });
    const p = await ctx.newPage();
    monitor(p, faults);
    await p.goto(base + "/#entity=" + encodeURIComponent(entity), { waitUntil: "networkidle" });
    await p.waitForSelector("#system-view h3");
    const overflow = await p.evaluate(() => ({
      body: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      tables: Array.from(document.querySelectorAll("#system-view .table-scroll"), (w) => w.scrollWidth >= w.clientWidth).length,
    }));
    check(overflow.body <= 0, `body overflows horizontally at ${width}px ${scheme}`);
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
