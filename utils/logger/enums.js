// utils/logger/enums.js
// Event severity types and tags, matching the suite's util.app_run_logs events
// (utils/logger/enums.js across the other apps). The dashboard's self-log emits the
// same shapes so it renders in the grid/error feed like any other app.
"use strict";

const TYPE = { INFO: "INFO", WARN: "WARN", ERROR: "ERROR" };
const TAG = {
  CALL: "CALL",
  DETAILS: "DETAILS",
  CATCH: "CATCH",
  SEQUENCE_HALTED: "SEQUENCE HALTED",
  QA_FAILURE: "QA FAILURE",
};

module.exports = { TYPE, TAG };
