"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const Routes = require("../public/routes");

test("entity-first routes and preserved route families have accurate parents/sources", () => {
  assert.equal(Routes.parse("").id, "entities");
  assert.equal(Routes.parse("#incidents").id, "entities");
  assert.equal(Routes.parse("#jobs").id, "jobs");
  assert.equal(Routes.parse("#incident-list").id, "incident-list");
  assert.equal(Routes.parse("#connectivity").source, "alert.*");
  assert.equal(Routes.parse("#acq-systems").source, "stats.acquisition_history");
  assert.equal(Routes.parse("#incident=12").nav, "incident-list");
  assert.equal(Routes.parse("#entity=SME1&from=entities").nav, "entities");
  // Phase 32: the legacy system route is an alias of the entity workspace — it
  // labels as the entity, owns the Entities nav, declares the workspace's
  // three-source scope, and a bare bookmark returns to the Entities default.
  const legacy = Routes.parse("#system=SME1");
  assert.equal(legacy.nav, "entities");
  assert.equal(legacy.label, "Entity SME1");
  assert.equal(legacy.returnHref, "#");
  assert.equal(legacy.source, "incidents.* + alert.* + util.app_run_logs");
  assert.equal(Routes.parse("#entity=SME1").source, "incidents.* + alert.* + util.app_run_logs");
  // A supplied safe origin still wins over the fallback.
  assert.equal(Routes.parse("#system=SME1&from=systems").returnHref, "#systems");
  assert.equal(Routes.parse("#entity=SME1&from=connectivity").returnHref, "#connectivity");
  // entity:<id> return tokens round-trip for incident/run detail returns.
  assert.equal(Routes.parse("#incident=9&from=entity%3ASME1").returnHref, "#entity=SME1");
  assert.equal(Routes.fromHref("entity:SME1"), "#entity=SME1");
});

test("compound run keeps hint and validated return context", () => {
  const route = Routes.parse("#run=abc&at=2026-01-01T00%3A00%3A00Z&from=incident%3A17");
  assert.equal(route.params.at, "2026-01-01T00:00:00Z");
  assert.equal(route.returnHref, "#incident=17");
});

test("all scoped return contexts round trip to their parent route", () => {
  assert.equal(Routes.fromHref("entities"), "#");
  assert.equal(Routes.fromHref("jobs"), "#jobs");
  assert.equal(Routes.fromHref("incident-list"), "#incident-list");
  assert.equal(Routes.fromHref("appruns:data_acquisition"), "#appruns=data_acquisition");
  assert.equal(Routes.fromHref("entity:SME_123"), "#entity=SME_123");
  assert.equal(Routes.fromHref("system:SME_123"), "#system=SME_123");
  assert.equal(Routes.fromHref("incident:17"), "#incident=17");
});

test("legacy return tokens preserve their old intent under the new hierarchy", () => {
  assert.equal(Routes.fromHref("dashboard"), "#jobs");
  assert.equal(Routes.fromHref("incidents"), "#incident-list");
  assert.equal(Routes.parse("#run=x&from=dashboard").returnHref, "#jobs");
  assert.equal(Routes.parse("#incident=9&from=incidents").returnHref, "#incident-list");
});

test("safe encoded ids parse and invalid entity/system ids fall back deterministically", () => {
  const entity = Routes.parse("#entity=SME_123&from=incident-list");
  assert.equal(entity.id, "entity");
  assert.equal(entity.params.entity, "SME_123");
  assert.equal(entity.returnHref, "#incident-list");
  assert.equal(Routes.parse("#entity=bad%20value").id, "entities");
  assert.equal(Routes.parse("#system=bad%2Fvalue").id, "systems");
});

test("unsafe from values fail to deterministic route fallback", () => {
  assert.equal(Routes.parse("#run=x&from=https%3A%2F%2Fevil.test").returnHref, "#jobs");
  assert.equal(Routes.parse("#incident=9&from=javascript%3Aalert(1)").returnHref, "#incident-list");
});
