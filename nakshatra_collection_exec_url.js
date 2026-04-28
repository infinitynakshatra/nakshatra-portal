/**
 * Infinity Nakshatra — Apps Script Web App /exec URL
 *
 * Edit this file when you create a new Apps Script deployment.
 * The main dashboard reads globalThis.__NAKSHATRA_COLLECTION_EXEC_URL__ (set here by default).
 */
(function (g) {
  if (!g) return;
  var v = String(g.__NAKSHATRA_COLLECTION_EXEC_URL__ || "").replace(/^\uFEFF/, "").trim();
  if (v) return;
  g.__NAKSHATRA_COLLECTION_EXEC_URL__ = "https://script.google.com/macros/s/AKfycbzb0rCrAZsblO78Py05zq5gRuEUmX6pU1G6D_5kDQE37KkZ3b2q_BF1ccG1FoUtyytu/exec";
})(typeof globalThis !== "undefined" ? globalThis : window);
