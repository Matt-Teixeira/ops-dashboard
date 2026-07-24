// Walk every ops-dashboard view and screenshot it.
const { chromium } = require("playwright");

const BASE = "http://localhost:8080";
const OUT = "/work/shots";

(async () => {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  const shot = async (name, fullPage = false) => {
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${OUT}/${name}.png`, fullPage });
    console.log("shot:", name);
  };

  // 1. Dashboard
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForSelector("#grid tbody tr");
  await shot("01-dashboard-top");
  await shot("01b-dashboard-full", true);

  // 2. Dashboard, group by none + a search filter
  await page.selectOption("#group-by", "none");
  await shot("02-dashboard-flat");
  await page.fill("#grid-search", "hhm");
  await page.waitForTimeout(400);
  await shot("02b-dashboard-search");
  await page.fill("#grid-search", "");
  await page.selectOption("#group-by", "app");
  await page.waitForTimeout(400);

  // 3. data_acquisition inline runs expansion
  const daToggle = await page.$("a:has-text('12h runs')");
  if (daToggle) { await daToggle.click(); await page.waitForTimeout(800); await shot("03-da-expanded"); }

  // 4. Run drill-down (ERROR run from the grid API)
  const jobs = await page.evaluate(() => fetch("/api/jobs/latest").then((r) => r.json()));
  const errJob = jobs.jobs.find((j) => j.status === "ERROR") || jobs.jobs.find((j) => j.status === "WARN");
  await page.goto(BASE + "/#run=" + errJob.runId + "&at=" + encodeURIComponent(errJob.lastRun));
  await page.waitForSelector("#run-view table");
  await shot("04-run-drilldown");
  await shot("04b-run-drilldown-full", true);

  // 5. Connectivity
  await page.goto(BASE + "/#connectivity");
  await page.waitForSelector("#connectivity-view table");
  await shot("05-connectivity");

  // 6. Systems
  await page.goto(BASE + "/#systems");
  await page.waitForSelector("#systems-view table");
  await shot("06-systems");

  // 7. System detail
  const sys = await page.evaluate(() => fetch("/api/systems").then((r) => r.json()));
  await page.goto(BASE + "/#system=" + sys.systems[0].systemId);
  await page.waitForSelector("#system-view table");
  await shot("07-system-detail");

  // 8. Incidents
  await page.goto(BASE + "/#incidents");
  await page.waitForSelector("#incidents-view table");
  await shot("08-incidents");

  // 9. Incident detail
  const inc = await page.evaluate(() => fetch("/api/incidents").then((r) => r.json()));
  await page.goto(BASE + "/#incident=" + inc.incidents[0].id);
  await page.waitForSelector("#incident-view table");
  await shot("09-incident-detail");
  await shot("09b-incident-detail-full", true);

  // 10. Per-app run log
  await page.goto(BASE + "/#appruns=hhm_rpp_ge");
  await page.waitForSelector("#appruns-view table");
  await shot("10-appruns");

  // 11. Acquisition systems
  await page.goto(BASE + "/#acq-systems");
  await page.waitForSelector("#acq-view table, #acq-view p");
  await shot("11-acq-systems");

  // 12. Mobile-width dashboard
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + "/");
  await page.waitForSelector("#grid tbody tr");
  await shot("12-mobile-dashboard");

  console.log("console errors:", JSON.stringify(consoleErrors, null, 2));
  await browser.close();
})();
