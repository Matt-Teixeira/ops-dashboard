"use strict";

// Reproducible browser gate for the Phase 31 entity-first dashboard. Run only
// against the disposable port-18080 app. Screenshots go to EVIDENCE_DIR.
const { chromium } = require("playwright");

const base = process.env.APP_BASE || "http://127.0.0.1:18080";
const evidenceDir = process.env.EVIDENCE_DIR || "/tmp/ops-dashboard-phase31-evidence";

function check(value, message) {
  if (!value) throw new Error(message);
}

function monitor(page, faults) {
  page.on("pageerror", (error) => faults.push("pageerror: " + error.message));
  page.on("console", (message) => {
    if (message.type() === "error") faults.push("console: " + message.text());
  });
}

async function selectWithKeyboard(page, selector, key, expected) {
  const control = page.locator(selector);
  await control.focus();
  await page.keyboard.press(key);
  await page.keyboard.press("Enter");
  await page.waitForFunction(({ selector, expected }) =>
    document.querySelector(selector)?.value === expected, { selector, expected });
  check(await control.evaluate((element) => document.activeElement === element),
    selector + " lost keyboard focus");
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const faults = [];
  const results = {};
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  const page = await context.newPage();
  monitor(page, faults);

  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForSelector("#entity-cards article");
  const api = await page.evaluate(async () => (await fetch("/api/entities")).json());
  check(api.entities.length === 229 && api.nonSmeEntities.length === 2,
    "unexpected representative live cardinality");

  const initial = await page.evaluate(() => ({
    title: document.title,
    source: document.querySelector("#source-label").textContent,
    nav: document.querySelector("[aria-current=page]")?.id,
    cards: document.querySelectorAll("#entity-cards article").length,
    jobsHidden: document.querySelector("#dashboard").hidden,
    status: document.querySelector("#entities-status").textContent,
    summary: Array.from(document.querySelectorAll("#entity-summary .tile"), (tile) => ({
      label: tile.querySelector(".muted")?.textContent,
      value: Number(tile.querySelector("b")?.textContent),
    })),
    nonSme: document.querySelector("#non-sme-notice").textContent,
  }));
  check(initial.title.startsWith("Entities") && initial.source.includes("incidents.incidents") &&
    initial.nav === "nav-entities" && initial.cards === 24 && initial.jobsHidden,
  "default route is not entity-first: " + JSON.stringify(initial));
  const tileMap = Object.fromEntries(initial.summary.map((item) => [item.label, item.value]));
  check(tileMap["SME entities"] === api.summary.entityCount &&
    tileMap["with active work"] === api.summary.entitiesWithActive &&
    tileMap["active incidents"] === api.summary.activeIncidentCount &&
    tileMap["total incidents"] === api.summary.incidentCount &&
    tileMap["non-SME incidents"] === api.summary.nonSme.incidentCount,
  "summary tiles do not reconcile to /api/entities");
  check(initial.nonSme.includes("__global__") && initial.nonSme.includes("RTT00001") &&
    initial.nonSme.includes("12 incidents"), "non-SME reconciliation is not discoverable");
  results.initial = initial;

  // Progressive rendering changes only the DOM slice, not global truth.
  const summaryBefore = await page.locator("#entity-summary").textContent();
  await page.locator("#entity-more").click();
  await page.waitForFunction(() => document.querySelectorAll("#entity-cards article").length === 48);
  check(await page.locator("#entity-more").evaluate((button) => document.activeElement === button),
    "first show-more expansion lost focus");
  await page.locator("#entity-more").click();
  await page.waitForFunction(() => document.querySelectorAll("#entity-cards article").length === 72);
  check(await page.locator("#entity-summary").textContent() === summaryBefore,
    "global summary changed with the rendered card slice");
  results.progressive = { cards: 72, summaryStable: true };

  // Search and representative provenance/card semantics.
  const search = page.locator("#entity-search");
  await search.focus(); await search.fill(""); await search.type("16380");
  await page.waitForFunction(() => document.querySelectorAll("#entity-cards article").length === 1);
  const mixedCard = await page.locator("#entity-cards article").evaluate((card) => ({
    text: card.textContent,
    times: Array.from(card.querySelectorAll("time"), (time) => ({ title: time.title, dateTime: time.dateTime })),
    href: card.querySelector("h3 a")?.getAttribute("href"),
  }));
  check(mixedCard.text.includes("includes oracle") && mixedCard.text.includes("occurrences") &&
    mixedCard.text.includes("apps (2)") && mixedCard.href.includes("#entity=SME16380&from=entities") &&
    mixedCard.times.every((time) => time.title && time.dateTime),
  "mixed-provenance card semantics failed: " + JSON.stringify(mixedCard));

  const oracleEntity = api.entities.find((entity) => entity.categories.some((category) =>
    category.sources.length === 1 && category.sources[0] === "oracle"));
  if (oracleEntity) {
    await search.fill(oracleEntity.entity);
    await page.waitForFunction((id) => document.querySelector("#entity-cards h3")?.textContent === id, oracleEntity.entity);
    check(await page.locator("#entity-cards .cat-oracle").count() > 0,
      "oracle-only category lacks the established hint treatment");
    results.oracleOnlyRepresentative = oracleEntity.entity;
  } else {
    results.oracleOnlyRepresentative = "none in current entity aggregate; pure rendering test applies";
  }

  // Every filter and sort is keyboard-operable; reset keeps the shell/focus stable.
  await page.locator("#entity-reset").focus(); await page.keyboard.press("Enter");
  await selectWithKeyboard(page, "#entity-activity", "ArrowDown", "all");
  const resolved = api.entities.find((entity) => entity.activeIncidentCount === 0);
  await search.focus(); await search.type(resolved.entity);
  await page.waitForSelector("#entity-cards .resolved-only");
  await search.focus(); await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace");
  await page.locator("#entity-reset").focus(); await page.keyboard.press("Enter");
  await selectWithKeyboard(page, "#entity-severity", "ArrowDown", "critical");
  await page.locator("#entity-reset").focus(); await page.keyboard.press("Enter");
  const firstCategory = await page.locator("#entity-category option").nth(1).getAttribute("value");
  await selectWithKeyboard(page, "#entity-category", "ArrowDown", firstCategory);
  await page.locator("#entity-reset").focus(); await page.keyboard.press("Enter");
  await selectWithKeyboard(page, "#entity-sort", "ArrowDown", "latest");
  await page.locator("#entity-reset").focus(); await page.keyboard.press("Enter");
  check(await page.locator("#entity-reset").evaluate((button) => document.activeElement === button),
    "reset rebuilt the controls or lost focus");
  results.keyboardFilters = true;

  // Canonical entity detail reuses the existing bounded system controller and returns.
  await search.fill("SME16380");
  const entityLink = page.locator("#entity-cards h3 a");
  await entityLink.focus(); await page.keyboard.press("Enter");
  await page.waitForSelector("#system-view:not([hidden])");
  check((await page.locator("#system-view h2").textContent()).startsWith("Entity SME16380"),
    "canonical entity route did not reuse the detail controller");
  check(await page.locator("#system-view > a").getAttribute("href") === "#",
    "entity return path is not deterministic");
  await page.locator("#system-view > a").click();
  await page.waitForSelector("#entity-cards article");
  await page.locator("#entity-reset").click();
  await page.waitForFunction(() => document.querySelectorAll("#entity-cards article").length === 24);

  // Alias/new routes preserve complete legacy views.
  await page.goto(base + "/#incidents", { waitUntil: "networkidle" });
  await page.waitForSelector("#entity-cards article");
  check(await page.locator("#entity-cards article").count() === 24 &&
    await page.locator("[aria-current=page]").getAttribute("id") === "nav-entities",
  "#incidents alias is not the same Entities view");

  await page.goto(base + "/#jobs", { waitUntil: "networkidle" });
  await page.waitForSelector("#grid tbody tr");
  const runHref = await page.locator("#grid a[aria-label^='run ']").first().getAttribute("href");
  check(await page.locator("#errors").count() === 1 &&
    await page.locator("[aria-current=page]").getAttribute("id") === "nav-jobs",
  "Jobs route did not preserve grid/feed");
  const stickyJobs = await page.evaluate(() => {
    const wrapper = document.querySelector("#grid").closest(".table-scroll");
    const header = document.querySelector("#grid thead th");
    wrapper.scrollTop = 300;
    return {
      scrollable: wrapper.scrollHeight > wrapper.clientHeight,
      scrollTop: wrapper.scrollTop,
      delta: Math.abs(header.getBoundingClientRect().top - wrapper.getBoundingClientRect().top),
    };
  });
  check(stickyJobs.scrollable && stickyJobs.scrollTop > 0 && stickyJobs.delta <= 2,
    "Jobs sticky geometry regressed: " + JSON.stringify(stickyJobs));
  const daToggle = page.locator("#da-runs-toggle");
  await daToggle.focus(); await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector("#da-runs-toggle")?.getAttribute("aria-expanded") === "true");
  check(await daToggle.evaluate((element) => element.tagName === "BUTTON"),
    "data_acquisition disclosure is not native");

  await page.goto(base + "/#incident-list", { waitUntil: "networkidle" });
  await page.waitForSelector("#incidents-view table");
  check((await page.locator("#incidents-view h2").textContent()) === "Incident list" &&
    await page.locator("#incident-category").count() === 1 &&
    (await page.locator("#incidents-view .muted").allTextContents()).some((text) => text.includes("incidents overall")),
  "raw incident list semantics regressed");
  const stickyIncidents = await page.evaluate(() => {
    const wrapper = document.querySelector("#incidents-view table").closest(".table-scroll");
    const header = document.querySelector("#incidents-view thead th");
    wrapper.scrollTop = 300;
    return {
      scrollable: wrapper.scrollHeight > wrapper.clientHeight,
      scrollTop: wrapper.scrollTop,
      delta: Math.abs(header.getBoundingClientRect().top - wrapper.getBoundingClientRect().top),
    };
  });
  check(stickyIncidents.scrollable && stickyIncidents.scrollTop > 0 && stickyIncidents.delta <= 2,
    "Incident-list sticky geometry regressed: " + JSON.stringify(stickyIncidents));
  const rawCategories = await page.locator("#incident-category option").evaluateAll((options) =>
    options.slice(1, 4).map((option) => option.value));
  check(rawCategories.length === 3, "not enough raw incident categories for focus traversal");
  for (const category of rawCategories) {
    await page.locator("#incident-category").focus();
    await page.selectOption("#incident-category", category);
    await page.waitForFunction((selected) => document.querySelector("#incident-category")?.value === selected &&
      document.activeElement?.id === "incident-category", category);
  }
  await page.locator("#incidents-view button", { hasText: "clear filters" }).click();
  await page.waitForFunction(() => document.querySelector("#incident-category")?.value === "all");
  const incidentHref = await page.locator("#incidents-view a[href^='#incident=']").first().getAttribute("href");
  const rawMore = page.locator("#incidents-view [data-incidents-more]");
  if (await rawMore.count()) {
    await rawMore.click();
    await page.waitForFunction(() => document.querySelectorAll("#incidents-view tbody tr").length > 100);
    check(await page.evaluate(() => document.activeElement?.dataset.incidentsMore === "true" ||
      document.activeElement?.classList.contains("table-scroll")),
    "raw incident load-more lost focus");
  }
  results.preservedPhase29 = { stickyJobs, stickyIncidents, rawCategoryFocus: true, daDisclosure: true };

  await page.goto(base + "/#systems", { waitUntil: "networkidle" });
  await page.waitForSelector("#systems-view table");
  const systemHref = await page.locator("#systems-view a[href^='#system=']").first().getAttribute("href");

  async function routeState(hash, section, expectedNav) {
    await page.goto(base + "/" + hash, { waitUntil: "networkidle" });
    await page.waitForSelector(section + ":not([hidden])");
    const state = await page.evaluate(({ section }) => ({
      title: document.title,
      source: document.querySelector("#source-label").textContent,
      nav: document.querySelector("[aria-current=page]")?.id,
      bodyContained: document.body.scrollWidth <= document.documentElement.clientWidth,
      tables: Array.from(document.querySelectorAll(section + " table"), (table) => ({
        wrapped: table.parentElement?.classList.contains("table-scroll"),
        caption: !!table.querySelector("caption"),
        scoped: Array.from(table.querySelectorAll("th")).every((header) => !!header.scope),
      })),
    }), { section });
    check(state.title.includes("ops-dashboard") && state.source && state.nav === expectedNav &&
      state.bodyContained && state.tables.every((table) => table.wrapped && table.caption && table.scoped),
    hash + " route failed: " + JSON.stringify(state));
    return state;
  }

  const routes = [];
  routes.push(["entities", await routeState("", "#entities-view", "nav-entities")]);
  routes.push(["jobs", await routeState("#jobs", "#dashboard", "nav-jobs")]);
  routes.push(["run", await routeState(runHref, "#run-view", "nav-jobs")]);
  routes.push(["connectivity", await routeState("#connectivity", "#connectivity-view", "nav-connectivity")]);
  routes.push(["acq", await routeState("#acq-systems", "#acq-view", "nav-jobs")]);
  routes.push(["systems", await routeState("#systems", "#systems-view", "nav-systems")]);
  routes.push(["system", await routeState(systemHref, "#system-view", "nav-systems")]);
  routes.push(["entity", await routeState("#entity=SME16380&from=entities", "#system-view", "nav-entities")]);
  routes.push(["incident-list", await routeState("#incident-list", "#incidents-view", "nav-incident-list")]);
  routes.push(["incident", await routeState(incidentHref, "#incident-view", "nav-incident-list")]);
  routes.push(["appruns", await routeState("#appruns=data_acquisition&from=jobs", "#appruns-view", "nav-jobs")]);
  results.routes = routes.map(([name]) => name);

  // Legacy return intent maps to the preserved explicit routes.
  const runTarget = new URLSearchParams(runHref.replace(/^#/, ""));
  await page.goto(base + "/#run=" + encodeURIComponent(runTarget.get("run")) +
    "&at=" + encodeURIComponent(runTarget.get("at")) + "&from=dashboard", { waitUntil: "networkidle" });
  await page.waitForSelector("#run-view:not([hidden])");
  check(await page.locator("#run-view > a").getAttribute("href") === "#jobs", "legacy dashboard return broke");
  const incidentId = new URLSearchParams(incidentHref.replace(/^#/, "")).get("incident");
  await page.goto(base + "/#incident=" + incidentId + "&from=incidents", { waitUntil: "networkidle" });
  await page.waitForSelector("#incident-view:not([hidden])");
  check(await page.locator("#incident-view > a").getAttribute("href") === "#incident-list",
    "legacy incidents return broke");
  results.legacyReturns = true;

  // Slow entity refresh followed by Jobs: no late body/chrome paint; button recovers.
  await page.goto(base + "/", { waitUntil: "networkidle" });
  let delayEntities = true;
  await page.route("**/api/entities", async (route) => {
    if (delayEntities) { delayEntities = false; await new Promise((resolve) => setTimeout(resolve, 700)); }
    await route.continue();
  });
  await page.locator("#refresh").click();
  await page.locator("#nav-jobs").click();
  await page.waitForSelector("#dashboard:not([hidden])");
  await page.waitForTimeout(850);
  const entityRaceState = await page.evaluate(() => ({
    title: document.title,
    nav: document.querySelector("[aria-current=page]")?.id,
    entitiesHidden: document.querySelector("#entities-view").hidden,
    refreshDisabled: document.querySelector("#refresh").disabled,
    refreshText: document.querySelector("#refresh").textContent,
  }));
  check(entityRaceState.title.startsWith("Jobs") && entityRaceState.nav === "nav-jobs" &&
    entityRaceState.entitiesHidden && !entityRaceState.refreshDisabled && entityRaceState.refreshText === "refresh",
  "slow Entities completion repainted Jobs or stranded refresh: " + JSON.stringify(entityRaceState));
  await page.unroute("**/api/entities");

  // Slow Jobs refresh followed by Entities has the symmetric ownership guarantee.
  let delayJobs = true;
  await page.route("**/api/jobs/latest", async (route) => {
    if (delayJobs) { delayJobs = false; await new Promise((resolve) => setTimeout(resolve, 700)); }
    await route.continue();
  });
  await page.locator("#refresh").click();
  await page.locator("#nav-entities").click();
  await page.waitForSelector("#entity-cards article");
  await page.waitForTimeout(850);
  check((await page.locator("#meta").textContent()).includes("Entities") &&
    await page.locator("#dashboard").isHidden() && !(await page.locator("#refresh").isDisabled()),
  "slow Jobs completion repainted Entities or stranded refresh");
  await page.unroute("**/api/jobs/latest");
  results.races = true;

  // Selected zero-count persisted category stays clearable by keyboard.
  const persisted = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await persisted.addInitScript(() => localStorage.setItem("ops-entity-view-v1", JSON.stringify({
    search: "", activity: "active", severity: "all", category: "not_present", sort: "priority",
  })));
  const persistedPage = await persisted.newPage(); monitor(persistedPage, faults);
  await persistedPage.goto(base + "/", { waitUntil: "networkidle" });
  await persistedPage.waitForFunction(() => document.querySelector("#entity-category")?.value === "not_present");
  check(!(await persistedPage.locator("#entity-category").isDisabled()) &&
    (await persistedPage.locator("#entities-status").textContent()).includes("No SME entities match"),
  "zero-count persisted category is trapped");
  await persistedPage.locator("#entity-category").focus(); await persistedPage.keyboard.press("Home");
  await persistedPage.keyboard.press("Enter");
  await persistedPage.waitForFunction(() => document.querySelector("#entity-category")?.value === "all" &&
    document.querySelectorAll("#entity-cards article").length > 0);
  results.zeroFilterClear = true;
  await persisted.close();

  // Distinct first-load warming and failure states retain accurate Entities chrome.
  for (const [name, status, expected] of [
    ["warming", 503, "warming up"], ["failure", 500, "Couldn't load"],
  ]) {
    const stateContext = await browser.newContext({ viewport: { width: 1000, height: 800 } });
    const statePage = await stateContext.newPage();
    await statePage.route("**/api/entities", (route) => route.fulfill({
      status, contentType: "application/json", body: JSON.stringify({ error: name }),
    }));
    await statePage.goto(base + "/", { waitUntil: "networkidle" });
    await statePage.waitForFunction((text) => document.querySelector("#entities-status")?.textContent.includes(text), expected);
    check(await statePage.locator("[aria-current=page]").getAttribute("id") === "nav-entities" &&
      await statePage.locator("#entity-cards article").count() === 0,
    name + " state has wrong route ownership");
    await stateContext.close();
  }
  results.emptyFailureStates = true;

  // Responsive/light-dark matrix: no body overflow, clipped cards, or invisible focus.
  const responsiveResults = [];
  for (const size of [
    { name: "mobile", width: 390, height: 844 },
    { name: "tablet", width: 768, height: 900 },
    { name: "desktop", width: 1440, height: 900 },
  ]) {
    for (const scheme of ["light", "dark"]) {
      const responsive = await browser.newContext({
        viewport: { width: size.width, height: size.height }, colorScheme: scheme,
      });
      const responsivePage = await responsive.newPage(); monitor(responsivePage, faults);
      await responsivePage.goto(base + "/", { waitUntil: "networkidle" });
      await responsivePage.waitForSelector("#entity-cards article");
      await responsivePage.locator("#entity-search").focus();
      const dimensions = await responsivePage.evaluate(() => {
        const cards = Array.from(document.querySelectorAll(".entity-card"));
        const search = document.querySelector("#entity-search");
        return {
          bodyContained: document.body.scrollWidth <= document.documentElement.clientWidth,
          cardsContained: cards.every((card) => card.scrollWidth <= card.clientWidth + 1 &&
            card.getBoundingClientRect().right <= document.documentElement.clientWidth + 1),
          focusOutline: getComputedStyle(search).outlineStyle,
          navHeight: document.querySelector(".app-chrome").getBoundingClientRect().height,
          columns: getComputedStyle(document.querySelector("#entity-cards")).gridTemplateColumns.split(" ").length,
        };
      });
      check(dimensions.bodyContained && dimensions.cardsContained && dimensions.focusOutline !== "none" &&
        (size.width > 600 || dimensions.columns === 1),
      `${size.name}-${scheme} responsive failure: ${JSON.stringify(dimensions)}`);
      await responsivePage.screenshot({
        path: `${evidenceDir}/phase31-${size.name}-${scheme}.png`, fullPage: true,
      });
      await responsivePage.goto(base + "/#jobs", { waitUntil: "networkidle" });
      await responsivePage.waitForSelector("#grid tbody tr");
      dimensions.jobsContained = await responsivePage.evaluate(() =>
        document.body.scrollWidth <= document.documentElement.clientWidth &&
        Array.from(document.querySelectorAll("#dashboard .table-scroll"))
          .every((wrapper) => wrapper.getAttribute("role") === "region"));
      await responsivePage.goto(base + "/#incident-list", { waitUntil: "networkidle" });
      await responsivePage.waitForSelector("#incidents-view table");
      dimensions.incidentsContained = await responsivePage.evaluate(() =>
        document.body.scrollWidth <= document.documentElement.clientWidth &&
        document.querySelector("#incidents-view .table-scroll")?.getAttribute("role") === "region");
      check(dimensions.jobsContained && dimensions.incidentsContained,
        `${size.name}-${scheme} preserved-view containment failed: ${JSON.stringify(dimensions)}`);
      responsiveResults.push({ name: size.name, scheme, ...dimensions });
      await responsive.close();
    }
  }
  results.responsive = responsiveResults;

  check(faults.length === 0, faults.join("\n"));
  await context.close();
  await browser.close();
  process.stdout.write(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error.stack);
  process.exit(1);
});
