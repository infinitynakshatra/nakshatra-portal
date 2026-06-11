/**
 * Infinity Nakshatra — Apps Script API URL for the portal
 *
 * Production (Cloudflare Pages): same-origin relay at /api/collection (functions/api/collection.js).
 * Local dev (blocked Google POST): python scripts/collection_proxy.py → http://127.0.0.1:8765
 * Direct (when browser can reach Google): full https://script.google.com/.../exec URL below.
 */
(function (g) {
  if (!g) return;
  var v = String(g.__NAKSHATRA_COLLECTION_EXEC_URL__ || "").replace(/^\uFEFF/, "").trim();
  if (v) return;

  var host = "";
  try {
    host = String(typeof location !== "undefined" && location.hostname ? location.hostname : "").toLowerCase();
  } catch (e0) {}

  // Cloudflare Pages (production + preview): browser → /api/collection → Google Apps Script
  if (host.endsWith(".pages.dev") || host === "nakshatra-portal.pages.dev") {
    try {
      g.__NAKSHATRA_COLLECTION_EXEC_URL__ = String(location.origin || "") + "/api/collection";
    } catch (e1) {
      g.__NAKSHATRA_COLLECTION_EXEC_URL__ = "/api/collection";
    }
    return;
  }

  g.__NAKSHATRA_COLLECTION_EXEC_URL__ =
    "https://script.google.com/macros/s/AKfycbymDJTDSDm-p9jSL7Y1TMJs3tb5ZKXJAQTlqq6b49hcO4Zr4sGS4bOslKEOfgOtJQ8w/exec";
})(typeof globalThis !== "undefined" ? globalThis : window);
