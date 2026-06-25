// index.js
// Entry point. Dispatches on argv[2] via a registry map, matching the suite's
// house style (cf. monday/index.js). The default/long-running job is `serve`.
"use strict";

require("dotenv").config();

const jobs = {
  serve: () => require("./server").start(),
  // digest: () => require("./jobs/stale_digest").run(),  // future batch job
};

async function on_boot() {
  const job = process.argv[2] || "serve";
  const handler = jobs[job];
  if (!handler) {
    throw new Error(`Unknown job "${job}". Known: ${Object.keys(jobs).join(", ")}`);
  }
  await handler();
}

on_boot().catch((err) => {
  console.error("[ops-dashboard] fatal:", err);
  process.exit(1);
});
