(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TimeView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function age(ms) {
    if (ms == null) return "—";
    const n = Number(ms);
    if (!Number.isFinite(n)) return "—";
    const seconds = Math.round(Math.max(0, n) / 1000);
    if (seconds < 90) return seconds + "s";
    const minutes = Math.round(seconds / 60);
    if (minutes < 90) return minutes + "m";
    const hours = Math.round(minutes / 60);
    if (hours < 48) return hours + "h";
    const days = Math.round(hours / 24);
    if (days < 730) return days + "d";
    return (days / 365).toFixed(days < 3650 ? 1 : 0) + "y";
  }

  function instant(value, now = Date.now()) {
    const ms = value instanceof Date ? value.getTime() : Date.parse(value);
    if (!Number.isFinite(ms)) return { relative: "—", iso: null, title: "timestamp unavailable" };
    const iso = new Date(ms).toISOString();
    return { relative: age(now - ms) + " ago", iso, title: new Date(ms).toLocaleString() + " · " + iso };
  }

  return { age, instant };
});
