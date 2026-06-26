// db/pgp.js
// Single pg-promise root instance, shared by every DB connection (the read-only
// pool and the writer), so the library is initialized exactly once.
"use strict";

module.exports = require("pg-promise")();
