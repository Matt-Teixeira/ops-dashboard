// public/feed-view.js
// Pure progressive-disclosure helpers shared by the dashboard error feed and
// incident event feed (Phase 22). DOM-free and dual-exported for browser + Node tests.
(function (root, factory) {
  "use strict";
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FeedView = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const PAGE_SIZE = 25;
  const PREVIEW_CHARS = 180;

  function clampWhole(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : fallback;
  }

  /** First non-empty line, bounded so one-line JSON cannot dominate the table. */
  function messagePreview(value, maxChars = PREVIEW_CHARS) {
    const text = value == null ? "" : String(value);
    const line = text.split(/\r?\n/).find((part) => part.trim()) || "";
    const clean = line.trim();
    const max = Math.max(2, clampWhole(maxChars, PREVIEW_CHARS));
    if (!clean) return "—";
    return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
  }

  /** Whether the full source contains information not represented by its preview. */
  function hasMoreText(value, maxChars = PREVIEW_CHARS) {
    const text = value == null ? "" : String(value);
    if (!text.trim()) return false;
    return text.trim() !== messagePreview(text, maxChars);
  }

  function initialCount(total, step = PAGE_SIZE) {
    const size = Math.max(1, clampWhole(step, PAGE_SIZE));
    return Math.min(clampWhole(total, 0), size);
  }

  function nextCount(current, total, step = PAGE_SIZE) {
    const max = clampWhole(total, 0);
    const shown = Math.min(clampWhole(current, 0), max);
    const size = Math.max(1, clampWhole(step, PAGE_SIZE));
    return Math.min(max, shown + size);
  }

  function countText(shown, fetched, occurrenceTotal = null) {
    const got = clampWhole(fetched, 0);
    const visible = Math.min(clampWhole(shown, 0), got);
    let text = `showing ${visible} of ${got} fetched`;
    const total = occurrenceTotal == null ? null : clampWhole(occurrenceTotal, got);
    if (total != null && total > got) text += ` · newest ${got} of ${total} occurrences`;
    return text;
  }

  /** JSON text that remains deterministic for unusual direct-call values. */
  function safeJson(value) {
    const seen = new WeakSet();
    try {
      const encoded = JSON.stringify(value, function (_key, current) {
        if (typeof current === "bigint") return String(current);
        if (current && typeof current === "object") {
          if (seen.has(current)) return "[Circular]";
          seen.add(current);
        }
        return current;
      });
      return encoded === undefined ? String(value) : encoded;
    } catch {
      try { return String(value); }
      catch { return "[Unserializable]"; }
    }
  }

  function displayValue(value) {
    return value && typeof value === "object" ? safeJson(value) : String(value);
  }

  function noteText(note) {
    if (note == null) return "";
    if (typeof note !== "object") return String(note);
    if (Array.isArray(note)) return safeJson(note);

    const rest = { ...note };
    const own = (key) => Object.prototype.hasOwnProperty.call(note, key);
    const headParts = [];

    if (own("system_id")) {
      const systemText = displayValue(note.system_id);
      headParts.push("system: " + systemText);
      delete rest.system_id;
      if (own("sme") && displayValue(note.sme) === systemText) delete rest.sme;
    }
    if (own("sme") && Object.prototype.hasOwnProperty.call(rest, "sme")) {
      headParts.push((own("system_id") ? "sme: " : "system: ") + displayValue(note.sme));
      delete rest.sme;
    }
    if (own("job_id")) {
      headParts.push("job: " + displayValue(note.job_id));
      delete rest.job_id;
    }

    const head = headParts.join("  ");
    const tail = Object.keys(rest).length ? safeJson(rest) : "";
    return [head, tail].filter(Boolean).join("\n");
  }

  return { PAGE_SIZE, PREVIEW_CHARS, messagePreview, hasMoreText, initialCount, nextCount, countText, noteText };
});
