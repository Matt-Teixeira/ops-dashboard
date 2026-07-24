"use strict";

// Run with Playwright from a disposable browser container. APP_BASE must address an
// isolated worktree instance, never the deployed service on port 8080.
const { chromium } = require("playwright");

const base = process.env.APP_BASE || "http://ops-dashboard-p29:8080";

function check(value, message) {
  if (!value) throw new Error(message);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const results = {};

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "light" });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => { window.__copiedRunId = value; } },
    });
  });
  const page = await context.newPage();
  const faults = [];
  page.on("pageerror", (error) => faults.push("pageerror: " + error.message));
  page.on("console", (message) => { if (message.type() === "error") faults.push("console: " + message.text()); });

  await page.goto(base + "/", { waitUntil: "networkidle" });
  await page.waitForSelector("#grid tbody tr");

  results.sticky = await page.evaluate(() => {
    const wrapper = document.querySelector("#grid").closest(".table-scroll");
    const header = document.querySelector("#grid thead th");
    const scrollable = wrapper.scrollHeight > wrapper.clientHeight;
    wrapper.scrollTop = 300;
    return {
      scrollable,
      scrollTop: wrapper.scrollTop,
      delta: Math.abs(header.getBoundingClientRect().top - wrapper.getBoundingClientRect().top),
    };
  });
  check(results.sticky.scrollable && results.sticky.scrollTop > 0 && results.sticky.delta <= 2,
    "sticky header geometry failed: " + JSON.stringify(results.sticky));

  const errorChip = page.locator("#status-chips button").filter({ hasText: "ERROR" }).first();
  await errorChip.click();
  const shadow = await errorChip.evaluate((element) => getComputedStyle(element).boxShadow);
  check(shadow.includes("21, 101, 192"), "selected chip ring is not blue: " + shadow);

  await page.locator("#da-runs-toggle").focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector("#da-runs-toggle")?.getAttribute("aria-expanded") === "true");
  check(await page.locator("#da-runs-toggle").evaluate((element) => element.tagName) === "BUTTON",
    "data_acquisition disclosure is not a button");

  const copy = page.locator(".copy-run").first();
  const copyLabel = await copy.getAttribute("aria-label");
  await copy.click();
  await page.waitForFunction(() => !!window.__copiedRunId);
  const copied = await page.evaluate(() => window.__copiedRunId);
  check(copyLabel.endsWith(copied), "full UUID copy mismatch");
  results.copiedRunId = copied;

  const firstDisclosure = page.locator("#errors button", { hasText: "show full" }).first();
  if (await firstDisclosure.count()) {
    const originalBodyId = await firstDisclosure.getAttribute("aria-controls");
    await firstDisclosure.click();
    const expandedText = await page.locator("#" + originalBodyId).textContent();
    const more = page.locator("#errors [data-feed-more]");
    if (await more.count()) {
      await more.click();
      const restored = page.locator("#errors button[aria-expanded=true]").first();
      check(await restored.count() === 1, "opened error disclosure collapsed");
      const restoredText = await page.locator("#" + await restored.getAttribute("aria-controls")).textContent();
      check(restoredText === expandedText,
        "opened error disclosure content changed: " + JSON.stringify({ expandedText, restoredText }));
      const focusOkay = await page.evaluate(() =>
        document.activeElement?.dataset.feedMore === "true" || document.activeElement?.id === "error-feed-summary");
      check(focusOkay, "error-feed show-more lost focus");
    }
  }

  await page.goto(base + "/#incidents", { waitUntil: "networkidle" });
  await page.waitForSelector("#incident-category");
  await page.goto(base + "/#", { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector("#meta").textContent.includes(" jobs "));
  results.dashboardSummary = await page.locator("#meta").textContent();

  await page.goto(base + "/#incidents", { waitUntil: "networkidle" });
  await page.waitForSelector("#incident-category");
  const categoryValues = await page.locator("#incident-category option").evaluateAll((options) =>
    options.slice(1, 4).map((option) => option.value));
  check(categoryValues.length === 3, "not enough categories for focus traversal");
  for (const value of categoryValues) {
    await page.locator("#incident-category").focus();
    await page.selectOption("#incident-category", value);
    await page.waitForFunction((selected) =>
      document.querySelector("#incident-category")?.value === selected &&
      document.activeElement?.id === "incident-category", value);
  }
  results.categoryFocus = true;

  let delayNextIncident = true;
  await page.route("**/api/incidents?*", async (route) => {
    if (delayNextIncident) {
      delayNextIncident = false;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    await route.continue();
  });
  await page.locator("#refresh").click();
  await page.locator("#nav-systems").click();
  await page.waitForSelector("#systems-view table");
  await page.waitForTimeout(900);
  results.refresh = await page.locator("#refresh").evaluate((button) => ({ disabled: button.disabled, text: button.textContent }));
  check(!results.refresh.disabled && results.refresh.text === "refresh", "refresh button remained stuck");
  await page.unroute("**/api/incidents?*");

  async function checkRoute(hash, section) {
    await page.goto(base + "/" + hash, { waitUntil: "networkidle" });
    await page.waitForSelector(section + " table");
    const state = await page.evaluate((selector) => {
      const tables = Array.from(document.querySelector(selector).querySelectorAll("table"));
      return {
        title: document.title,
        source: document.querySelector("#source-label").textContent,
        active: document.querySelector("[aria-current=page]")?.id,
        contained: tables.every((table) => table.parentElement?.classList.contains("table-scroll") &&
          table.parentElement?.getAttribute("role") === "region"),
        named: tables.every((table) => !!table.querySelector("caption")),
        scoped: tables.every((table) => Array.from(table.querySelectorAll("th")).every((header) => !!header.scope)),
      };
    }, section);
    check(state.title.includes("ops-dashboard") && state.source && state.contained && state.named && state.scoped,
      hash + " route semantics failed: " + JSON.stringify(state));
    return state.active;
  }

  const routes = [];
  routes.push(["dashboard", await checkRoute("", "#dashboard")]);
  const runHref = await page.locator("#grid a[aria-label^='run ']").first().getAttribute("href");
  routes.push(["connectivity", await checkRoute("#connectivity", "#connectivity-view")]);
  routes.push(["acq", await checkRoute("#acq-systems", "#acq-view")]);
  routes.push(["systems", await checkRoute("#systems", "#systems-view")]);
  const systemHref = await page.locator("#systems-view a[href^='#system=']").first().getAttribute("href");
  routes.push(["system", await checkRoute(systemHref, "#system-view")]);
  routes.push(["incidents", await checkRoute("#incidents", "#incidents-view")]);
  const incidentHref = await page.locator("#incidents-view a[href^='#incident=']").first().getAttribute("href");
  routes.push(["incident", await checkRoute(incidentHref, "#incident-view")]);
  routes.push(["appruns", await checkRoute("#appruns=data_acquisition", "#appruns-view")]);
  routes.push(["run", await checkRoute(runHref, "#run-view")]);
  results.routes = routes;

  for (const config of [
    { name: "mobile", width: 390, height: 844, scheme: "light" },
    { name: "tablet", width: 768, height: 900, scheme: "light" },
    { name: "desktop-dark", width: 1440, height: 900, scheme: "dark" },
  ]) {
    const responsive = await browser.newPage({
      viewport: { width: config.width, height: config.height }, colorScheme: config.scheme,
    });
    await responsive.goto(base + "/#connectivity", { waitUntil: "networkidle" });
    await responsive.waitForSelector("#connectivity-view table");
    const dimensions = await responsive.evaluate(() => {
      const wrapper = document.querySelector("#connectivity-view .table-scroll");
      return {
        bodyContained: document.body.scrollWidth <= document.documentElement.clientWidth,
        horizontal: wrapper.scrollWidth > wrapper.clientWidth,
        role: wrapper.getAttribute("role"),
      };
    });
    check(dimensions.bodyContained && (config.width > 768 || dimensions.horizontal) && dimensions.role === "region",
      config.name + " containment failed: " + JSON.stringify(dimensions));
    await responsive.screenshot({ path: "/tmp/p29-" + config.name + ".png", fullPage: true });
    await responsive.close();
  }

  // Persisted, active zero-count filter remains operable and obsolete age sort migrates.
  const persisted = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await persisted.addInitScript(() => localStorage.setItem("ops-grid-view", JSON.stringify({
    groupBy: "app", sortKey: "age", sortDir: "desc", search: "", statuses: ["STALE"], collapsed: [],
  })));
  const persistedPage = await persisted.newPage();
  await persistedPage.route("**/api/jobs/latest", async (route) => {
    const response = await route.fetch();
    const json = await response.json();
    for (const job of json.jobs || []) job.stale = false;
    await route.fulfill({ response, json });
  });
  await persistedPage.goto(base + "/", { waitUntil: "networkidle" });
  const staleChip = persistedPage.locator("#status-chips button").filter({ hasText: "STALE 0" });
  await staleChip.waitFor();
  check(await staleChip.getAttribute("aria-pressed") === "true" && !(await staleChip.isDisabled()),
    "active zero-count chip is trapped");
  check(await persistedPage.locator("#grid th[data-sort-key=lastRun]").getAttribute("aria-sort") === "descending",
    "removed age sort was not migrated");
  await staleChip.click();
  check(await staleChip.getAttribute("aria-pressed") === "false", "active zero-count chip did not clear");
  await persisted.close();

  // Clipboard failure exposes a focused manual-copy control containing the bare id.
  const fallbackContext = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  await fallbackContext.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  });
  const fallbackPage = await fallbackContext.newPage();
  await fallbackPage.goto(base + "/", { waitUntil: "networkidle" });
  const fallbackCopy = fallbackPage.locator(".copy-run").first();
  const fallbackLabel = await fallbackCopy.getAttribute("aria-label");
  await fallbackCopy.click();
  const fallbackInput = fallbackPage.locator(".copy-fallback").first();
  await fallbackInput.waitFor();
  check(fallbackLabel.endsWith(await fallbackInput.inputValue()), "manual UUID fallback lost the full value");
  check(await fallbackInput.evaluate((element) => document.activeElement === element), "manual UUID fallback was not focused");
  results.copyFallback = true;
  await fallbackContext.close();

  // A 503 retry may continue warming the cache but must not own another route's chrome.
  const warm = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const warmPage = await warm.newPage();
  let warmRequests = 0;
  await warmPage.route("**/api/jobs/latest", async (route) => {
    warmRequests++;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "warming" }) });
  });
  await warmPage.goto(base + "/", { waitUntil: "domcontentloaded" });
  await warmPage.waitForFunction(() => document.querySelector("#meta").textContent.includes("warming"));
  await warmPage.goto(base + "/#incidents", { waitUntil: "networkidle" });
  await warmPage.waitForSelector("#incidents-view table");
  const incidentMeta = await warmPage.locator("#meta").textContent();
  await warmPage.waitForTimeout(3300);
  check(await warmPage.locator("#meta").textContent() === incidentMeta, "warm-up retry clobbered incident chrome");
  check(warmRequests <= 2, "parallel warm-up retry chains detected: " + warmRequests);
  results.warmRequests = warmRequests;
  await warm.close();

  check(faults.length === 0, faults.join("\n"));
  await context.close();
  await browser.close();
  process.stdout.write(JSON.stringify(results));
}

main().catch((error) => {
  console.error(error.stack);
  process.exit(1);
});
