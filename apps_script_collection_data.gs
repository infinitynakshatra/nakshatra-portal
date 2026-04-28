/**
 * Infinity Nakshatra — collection writeback + month-wise sheet backup
 *
 * Deploy as Web app:
 *   Execute as: Me
 *   Who has access: Anyone (or Anyone with Google account — match your needs)
 *
 * 1) Set SCRIPT_API_KEY to a long random secret.
 * 2) SPREADSHEET_ID must match the portal HTML (same Google Sheet).
 * 3) Master log tab: collection_data (created automatically if missing).
 * 4) Each row is also copied to a month tab: collection_m_YYYYMM
 *      e.g. ym "2025-04" -> tab name "collection_m_202504"
 *
 * POST JSON:
 *   { "apiKey": "...", "entry": { ... } }  — single collection row (same as before)
 *   { "apiKey": "...", "action": "bulk", "entries": [ {...}, ... ] } — many collection rows
 *   { "apiKey": "...", "action": "updatePlotRow", "sheetGid": 1304899070, "plotNo": "12",
 *     "updates": { "Primary Contact Number": "9876543210", "Alternate Number": "" } }
 *     — writes cells on the owner-data tab (same gid as CSV). Header row = row 1.
 *   { "apiKey": "...", "action": "upsertPlotRow", "sheetGid": 1304899070, "plotNo": "99",
 *     "insert": true, "values": { "Plot No.": "99", "Sold/Unsold": "Unsold", ... } }
 *     — insert new row (insert true) or update all given columns (insert false).
 */

/** Must match COLLECTION_API_KEY in infinity_nakshatra_dashboard.html (rotate if this file is shared publicly). */
const SCRIPT_API_KEY = "xUNCXr9NM3AT_-62lagdREjlfca685cuzgTXCttCNFQ";
const SPREADSHEET_ID = "1vthuqpQqwaRGaJhaoJxVaHXv3Fd87M4eHeU9h3jDHWA";
const TARGET_SHEET_NAME = "collection_data";
/** Prefix for per-calendar-month backup tabs (ym format YYYY-MM in portal). */
const MONTH_TAB_PREFIX = "collection_m_";

// Portal backend tabs (shared across devices)
const PORTAL_PAYMENTS_SHEET = "portal_payments";
const PORTAL_PENDING_SHEET = "portal_pending_requests";
const PORTAL_TICKETS_SHEET = "portal_tickets";
const PORTAL_NOTICES_SHEET = "portal_notices";
const PORTAL_AUDIT_SHEET = "portal_audit";

const PORTAL_PAYMENTS_HEADERS = ["id","atIso","plotNo","ym","amount","lateFee","by","source","note","requesterMobile"];
const PORTAL_PENDING_HEADERS = ["id","plotNo","ym","amount","lateFee","requesterMobile","requestedAt"];
const PORTAL_TICKETS_HEADERS = ["id","plotNo","requesterMobile","category","description","status","createdAt","updatedAt","adminComment"];
const PORTAL_NOTICES_HEADERS = ["id","title","body","audience","createdAt","createdBy","attachmentUrl"];
const PORTAL_AUDIT_HEADERS = ["atIso","actor","action","detail"];

function ensureSheetWithHeaders_(ss, name, headers) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    return sh;
  }
  var lastCol = sh.getLastColumn();
  if (lastCol < headers.length) lastCol = headers.length;
  var cur = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var need = false;
  for (var i = 0; i < headers.length; i++) {
    if (String(cur[i] || "").trim() !== String(headers[i])) { need = true; break; }
  }
  if (need) {
    sh.insertRowBefore(1);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sh;
}

function nowIso_() { return new Date().toISOString(); }
function newId_() { return Utilities.getUuid(); }

function normalizeYm_(ym) {
  var s = String(ym || "").trim();
  var m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return s;
  var mm = String(m[2]).padStart(2, "0");
  return m[1] + "-" + mm;
}

/** When Sheets formats `ym` as a date, getValues() returns Date — use for reads, merges, and delete matching. */
function ymCellToCanon_(ss, v) {
  if (v instanceof Date) {
    try {
      return Utilities.formatDate(v, ss.getSpreadsheetTimeZone(), "yyyy-MM");
    } catch (e) {
      return normalizeYm_(v);
    }
  }
  return normalizeYm_(v);
}

/** plotNo|ym for de-duplicating merged payment rows */
function portalPaymentKey_(plotNo, ym) {
  return String(plotNo || "").trim() + "|" + normalizeYm_(ym);
}

/** When two records exist for the same plot+month, prefer real money + latest timestamp. */
function pickBetterPortalPayment_(a, b) {
  if (!a) return b;
  if (!b) return a;
  var aa = Number(a.amount || 0) + Number(a.lateFee || 0);
  var bb = Number(b.amount || 0) + Number(b.lateFee || 0);
  if (bb > aa) return b;
  if (aa > bb) return a;
  var ta = Date.parse(String(a.atIso || "")) || 0;
  var tb = Date.parse(String(b.atIso || "")) || 0;
  return tb >= ta ? b : a;
}

function mergePortalPaymentsDedupe_(portalRows, collectionRows) {
  var map = {};
  var i;
  for (i = 0; i < portalRows.length; i++) {
    var pr = portalRows[i];
    var k = portalPaymentKey_(pr.plotNo, pr.ym);
    if (!k || k === "|") continue;
    map[k] = pr;
  }
  for (i = 0; i < collectionRows.length; i++) {
    var cr = collectionRows[i];
    var k2 = portalPaymentKey_(cr.plotNo, cr.ym);
    if (!k2 || k2 === "|") continue;
    map[k2] = pickBetterPortalPayment_(map[k2], cr);
  }
  var out = [];
  for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) out.push(map[k]);
  return out;
}

function invalidatePortalStateCache_() {
  try { CacheService.getScriptCache().remove("portal_state_v1"); } catch (e) {}
}

function audit_(ss, actor, action, detailObj) {
  var sh = ensureSheetWithHeaders_(ss, PORTAL_AUDIT_SHEET, PORTAL_AUDIT_HEADERS);
  var detail = "";
  try { detail = JSON.stringify(detailObj || {}); } catch (e) { detail = String(detailObj || ""); }
  sh.appendRow([nowIso_(), String(actor || ""), String(action || ""), detail]);
}

function rowsToObjects_(sh, headers) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = Math.max(sh.getLastColumn(), headers.length);
  var values = sh.getRange(2, 1, lastRow, lastCol).getValues();
  var out = [];
  for (var r = 0; r < values.length; r++) {
    var row = values[r];
    var o = {};
    for (var c = 0; c < headers.length; c++) o[headers[c]] = row[c];
    out.push(o);
  }
  return out;
}

function upsertById_(sh, headers, id, obj) {
  var lastRow = sh.getLastRow();
  var idCol = 1; // headers[0] is id
  var target = -1;
  if (lastRow >= 2) {
    var ids = sh.getRange(2, idCol, lastRow, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) === String(id)) { target = i + 2; break; }
    }
  }
  var row = [];
  for (var c = 0; c < headers.length; c++) row.push(obj[headers[c]] != null ? obj[headers[c]] : "");
  if (target < 0) {
    sh.appendRow(row);
    return { ok: true, mode: "insert", row: sh.getLastRow() };
  }
  sh.getRange(target, 1, 1, headers.length).setValues([row]);
  return { ok: true, mode: "update", row: target };
}

function deleteWhere_(sh, predicate) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var values = sh.getRange(2, 1, lastRow, sh.getLastColumn()).getValues();
  var removed = 0;
  for (var i = values.length - 1; i >= 0; i--) {
    if (predicate(values[i])) {
      sh.deleteRow(i + 2);
      removed++;
    }
  }
  return removed;
}

function paymentExists_(paymentsSh, plotNo, ym) {
  var lastRow = paymentsSh.getLastRow();
  if (lastRow < 2) return false;
  var ss = paymentsSh.getParent();
  var vals = paymentsSh.getRange(2, 1, lastRow, 4).getValues(); // id, atIso, plotNo, ym
  var y = normalizeYm_(ym);
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][2]) === String(plotNo) && ymCellToCanon_(ss, vals[i][3]) === y) return true;
  }
  return false;
}

function paymentsFromCollectionData_(ss) {
  // Build payments list from collection_data log so portal reflects entries even if portal_payments is missing.
  var sh = ss.getSheetByName(TARGET_SHEET_NAME);
  if (!sh) return [];
  ensureHeaders_(sh);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var start = Math.max(2, lastRow - 4999); // limit scan for performance
  var lastCol = Math.max(sh.getLastColumn(), COLLECTION_HEADERS.length);
  // IMPORTANT: getRange(startRow, startCol, endRow, endCol) — endRow must be lastRow, not row count.
  var vals = sh.getRange(start, 1, lastRow, lastCol).getValues();
  var map = {};
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    var plotNo = String(r[1] || "").trim();
    var ym = ymCellToCanon_(ss, r[2]);
    if (!plotNo || !ym) continue;
    var key = plotNo + "|" + ym;
    var atIso = String(r[0] || "");
    // Keep latest by timestamp string (ISO sort ok) or last seen
    map[key] = {
      id: "",
      atIso: atIso,
      plotNo: plotNo,
      ym: ym,
      amount: Number(r[4] || 0),
      lateFee: Number(r[5] || 0),
      by: String(r[6] || ""),
      source: "collection_data",
      note: String(r[11] || ""),
      requesterMobile: String(r[8] || "")
    };
  }
  var out = [];
  for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) out.push(map[k]);
  return out;
}

function getPortalState_(ss) {
  // Small cache to speed up repeated dashboard refreshes.
  // Avoid long stale cache; keep very short.
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get("portal_state_v1");
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (eParse) {
        try {
          cache.remove("portal_state_v1");
        } catch (eRm) {}
      }
    }
  } catch (e0) {}

  var pay = ensureSheetWithHeaders_(ss, PORTAL_PAYMENTS_SHEET, PORTAL_PAYMENTS_HEADERS);
  var pen = ensureSheetWithHeaders_(ss, PORTAL_PENDING_SHEET, PORTAL_PENDING_HEADERS);
  var tix = ensureSheetWithHeaders_(ss, PORTAL_TICKETS_SHEET, PORTAL_TICKETS_HEADERS);
  var noti = ensureSheetWithHeaders_(ss, PORTAL_NOTICES_SHEET, PORTAL_NOTICES_HEADERS);
  var payments = rowsToObjects_(pay, PORTAL_PAYMENTS_HEADERS);
  var out = {
    ok: true,
    payments: payments,
    pending: rowsToObjects_(pen, PORTAL_PENDING_HEADERS),
    tickets: rowsToObjects_(tix, PORTAL_TICKETS_HEADERS),
    notices: rowsToObjects_(noti, PORTAL_NOTICES_HEADERS)
  };
  // Normalize ym fields so clients are consistent.
  try {
    for (var i = 0; i < out.payments.length; i++) out.payments[i].ym = normalizeYm_(out.payments[i].ym);
    for (var j = 0; j < out.pending.length; j++) out.pending[j].ym = normalizeYm_(out.pending[j].ym);
  } catch (eN) {}

  // Merge collection_data-derived payments with portal_payments (same plot+month: pick best row).
  try {
    var colPay = paymentsFromCollectionData_(ss);
    out.payments = mergePortalPaymentsDedupe_(out.payments, colPay);
  } catch (eM) {}
  try {
    // Longer TTL avoids a burst of concurrent /state recomputes returning subtly different payloads;
    // mutations still call invalidatePortalStateCache_().
    CacheService.getScriptCache().put("portal_state_v1", JSON.stringify(out), 120);
  } catch (e1) {}
  return out;
}

const COLLECTION_HEADERS = [
  "atIso",
  "plotNo",
  "ym",
  "monthLabel",
  "amount",
  "lateFee",
  "role",
  "ownerName",
  "mobile",
  "groupStatus",
  "userAgent",
  "note"
];

function doOptions() {
  // ContentService TextOutput does not support setting custom headers in all environments.
  // The portal posts using Content-Type: text/plain (simple request) so no preflight is needed.
  return ContentService
    .createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT);
}

// Browser health-check (opening /exec in a tab is a GET).
function doGet() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    // Ensure key tabs exist so the first POST doesn't race-create them.
    ensureSheetWithHeaders_(ss, PORTAL_PAYMENTS_SHEET, PORTAL_PAYMENTS_HEADERS);
    ensureSheetWithHeaders_(ss, PORTAL_PENDING_SHEET, PORTAL_PENDING_HEADERS);
    ensureSheetWithHeaders_(ss, PORTAL_TICKETS_SHEET, PORTAL_TICKETS_HEADERS);
    ensureSheetWithHeaders_(ss, PORTAL_NOTICES_SHEET, PORTAL_NOTICES_HEADERS);
    ensureSheetWithHeaders_(ss, PORTAL_AUDIT_SHEET, PORTAL_AUDIT_HEADERS);
    return json_({ ok: true, service: "Infinity Nakshatra portal backend", now: nowIso_() }, 200);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) }, 500);
  }
}

function json_(obj, status) {
  const out = ContentService.createTextOutput(JSON.stringify(obj));
  out.setMimeType(ContentService.MimeType.JSON);
  // Some Apps Script environments don't support setting HTTP status codes on TextOutput.
  // The client uses the JSON body { ok: boolean, error?: string } to decide success/failure.
  return out;
}

/** ym "2025-04" (or "2025-4") -> "collection_m_202504"; invalid ym -> null */
function monthBackupSheetName_(ym) {
  const s = String(ym || "").trim();
  const m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (!m) return null;
  const mm = String(m[2]).padStart(2, "0");
  return MONTH_TAB_PREFIX + m[1] + mm;
}

function ensureHeaders_(sh) {
  if (sh.getLastRow() === 0) {
    sh.appendRow(COLLECTION_HEADERS);
    return;
  }
  const lc = sh.getLastColumn();
  if (lc < COLLECTION_HEADERS.length) {
    sh.getRange(1, 1, 1, COLLECTION_HEADERS.length).setValues([COLLECTION_HEADERS]);
    return;
  }
  const first = sh.getRange(1, 1).getValue();
  if (!first || String(first).trim() !== "atIso") {
    sh.insertRowBefore(1);
    sh.getRange(1, 1, 1, COLLECTION_HEADERS.length).setValues([COLLECTION_HEADERS]);
  }
}

function buildRow_(entry) {
  return [
    entry.atIso || new Date().toISOString(),
    entry.plotNo || "",
    entry.ym || "",
    entry.monthLabel || "",
    Number(entry.amount || 0),
    Number(entry.lateFee || 0),
    entry.role || "",
    entry.ownerName || "",
    entry.mobile || "",
    entry.groupStatus || "",
    entry.userAgent || "",
    entry.note != null ? String(entry.note) : ""
  ];
}

function collectionRowExists_(sh, plotNo, ym, note) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return false;
  var vals = sh.getRange(2, 1, lastRow, 12).getValues();
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (String(r[1]) === String(plotNo) && String(r[2]) === String(ym) && String(r[11]) === String(note)) return true;
  }
  return false;
}

function collectionAnyRowExists_(sh, plotNo, ym) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return false;
  var ss = sh.getParent();
  var vals = sh.getRange(2, 1, lastRow, 3).getValues(); // atIso, plotNo, ym
  var p = String(plotNo || "").trim();
  var y = normalizeYm_(ym);
  for (var i = 0; i < vals.length; i++) {
    var r = vals[i];
    if (String(r[1]).trim() === p && ymCellToCanon_(ss, r[2]) === y) return true;
  }
  return false;
}

/**
 * Append one logical collection row to master + optional month tab.
 */
function appendCollectionRow_(ss, entry) {
  const master = ss.getSheetByName(TARGET_SHEET_NAME) || ss.insertSheet(TARGET_SHEET_NAME);
  ensureHeaders_(master);
  const row = buildRow_(entry);
  const note = String(entry && entry.note != null ? entry.note : "");
  const plotNo = String(entry && entry.plotNo != null ? entry.plotNo : "");
  const ym = String(entry && entry.ym != null ? entry.ym : "");
  // Enforce ONE entry per plot+month in collection logs.
  // This prevents duplicates even if someone retries.
  if (collectionAnyRowExists_(master, plotNo, ym)) return;
  master.appendRow(row);

  const mname = monthBackupSheetName_(entry.ym);
  if (mname) {
    const msh = ss.getSheetByName(mname) || ss.insertSheet(mname);
    ensureHeaders_(msh);
    if (collectionAnyRowExists_(msh, plotNo, ym)) return;
    msh.appendRow(row);
  }
}

function deleteCollectionRowsForPlotMonths_(ss, plotNo, yms) {
  var plot = String(plotNo || "").trim();
  if (!plot) return 0;
  var setYm = {};
  for (var i = 0; i < (yms || []).length; i++) setYm[String(yms[i])] = true;
  var removed = 0;

  // Delete from master log
  var master = ss.getSheetByName(TARGET_SHEET_NAME);
  if (master) {
    removed += deleteWhere_(master, function(row){
      // headers: atIso, plotNo, ym, ... — ym may be a Date cell; must match setYm keys (e.g. 2026-05).
      return String(row[1]).trim() === plot && !!setYm[ymCellToCanon_(ss, row[2])];
    });
  }

  // Delete from month backup tabs
  for (var ym in setYm) {
    if (!Object.prototype.hasOwnProperty.call(setYm, ym)) continue;
    var mname = monthBackupSheetName_(ym);
    if (!mname) continue;
    var msh = ss.getSheetByName(mname);
    if (!msh) continue;
    var ymKey = normalizeYm_(ym);
    removed += deleteWhere_(msh, function(row){
      return String(row[1]).trim() === plot && ymCellToCanon_(ss, row[2]) === ymKey;
    });
  }
  return removed;
}

/** Map header cell text to portal canonical column name (empty = unknown). */
function mapHeaderToCanonical_(raw) {
  const t = String(raw || "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return "";
  if (t === "plot no" || t === "plot no." || t === "plotno") return "Plot No.";
  if (t.indexOf("sold") >= 0 && t.indexOf("unsold") >= 0) return "Sold/Unsold";
  if (t.indexOf("primary") >= 0 && t.indexOf("contact") >= 0) return "Primary Contact Number";
  if (t.indexOf("alternate") >= 0 && t.indexOf("number") >= 0) return "Alternate Number";
  if (t.indexOf("group") >= 0 && t.indexOf("status") >= 0) return "Group Status";
  if (/^name of owner 1/.test(t)) return "Name of Owner 1";
  if (/^name of owner 2/.test(t)) return "Name of Owner 2";
  if (/^name of owner 3/.test(t)) return "Name of Owner 3";
  return "";
}

/**
 * Find 1-based column index: exact header match, then canonical match (portal keys vs sheet headers).
 */
function findColByHeaderKey_(sh, key) {
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) return -1;
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  const want = String(key || "").trim();
  if (!want) return -1;
  var c;
  for (c = 0; c < headers.length; c++) {
    if (String(headers[c] || "").trim() === want) return c + 1;
  }
  var wantCanon = mapHeaderToCanonical_(want);
  if (wantCanon) {
    for (c = 0; c < headers.length; c++) {
      if (mapHeaderToCanonical_(headers[c]) === wantCanon) return c + 1;
    }
  }
  return -1;
}

function findPlotRow_(sh, plotNo) {
  const plotCol = findColByHeaderKey_(sh, "Plot No.");
  if (plotCol < 1) return -1;
  const lastRow = sh.getLastRow();
  var r;
  for (r = 2; r <= lastRow; r++) {
    if (String(sh.getRange(r, plotCol).getDisplayValue() || "").trim() === plotNo) return r;
  }
  return -1;
}

function mergedValueForHeader_(merged, hn) {
  const t = String(hn || "").trim();
  if (!t) return "";
  if (Object.prototype.hasOwnProperty.call(merged, t)) return merged[t];
  var wc = mapHeaderToCanonical_(hn);
  var mk;
  for (mk in merged) {
    if (!Object.prototype.hasOwnProperty.call(merged, mk)) continue;
    if (String(mk).trim() === t) return merged[mk];
    if (wc && mapHeaderToCanonical_(mk) === wc) return merged[mk];
  }
  return "";
}

function appendPlotDataRow_(sh, plotNo, vals) {
  const lastCol = sh.getLastColumn();
  if (lastCol < 1) return { ok: false, error: "sheet has no header row" };
  const headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var merged = {};
  var k;
  for (k in vals) {
    if (Object.prototype.hasOwnProperty.call(vals, k)) merged[String(k).trim()] = vals[k];
  }
  merged["Plot No."] = plotNo;
  var su = mergedValueForHeader_(merged, "Sold/Unsold");
  if (!String(su || "").trim()) merged["Sold/Unsold"] = "Unsold";

  var out = [];
  var c;
  for (c = 0; c < headers.length; c++) {
    var hn = String(headers[c] || "").trim();
    var v = mergedValueForHeader_(merged, hn);
    out.push(v === undefined || v === null ? "" : v);
  }
  sh.appendRow(out);
  return { ok: true, mode: "insert", row: sh.getLastRow() };
}

/**
 * Full-row upsert for raw_data tab: update existing plot row or append new (insert true).
 */
function upsertPlotRowInSheet_(ss, data) {
  const gid = Number(data.sheetGid);
  if (!gid) return { ok: false, error: "sheetGid required" };
  const plotNo = String(data.plotNo || "").trim();
  if (!plotNo) return { ok: false, error: "plotNo required" };
  const values = data.values || {};
  const insert = !!data.insert;
  var sh;
  try {
    sh = ss.getSheetById(gid);
  } catch (e1) {
    return { ok: false, error: "invalid sheet gid: " + String(gid) };
  }
  if (!sh) return { ok: false, error: "sheet not found for gid " + String(gid) };

  var existing = findPlotRow_(sh, plotNo);
  if (insert) {
    if (existing >= 0) return { ok: false, error: "Plot already exists; pick it from the list to edit." };
    return appendPlotDataRow_(sh, plotNo, values);
  }
  if (existing < 0) return { ok: false, error: "plot not found: " + plotNo };

  var written = [];
  var keys = Object.keys(values);
  var ki;
  for (ki = 0; ki < keys.length; ki++) {
    var key = keys[ki];
    var col = findColByHeaderKey_(sh, key);
    if (col < 1) continue;
    sh.getRange(existing, col).setValue(values[key]);
    written.push(key);
  }
  return { ok: true, mode: "update", row: existing, columns: written };
}

/**
 * Update cells for one plot (legacy: updates object; uses same column resolver).
 */
function updatePlotRowInSheet_(ss, data) {
  const gid = Number(data.sheetGid);
  if (!gid) return { ok: false, error: "sheetGid required" };
  const plotNo = String(data.plotNo || "").trim();
  if (!plotNo) return { ok: false, error: "plotNo required" };
  const updates = data.updates || {};
  if (typeof updates !== "object") return { ok: false, error: "updates must be an object" };

  var sh;
  try {
    sh = ss.getSheetById(gid);
  } catch (e) {
    return { ok: false, error: "invalid sheet gid: " + String(gid) };
  }
  if (!sh) return { ok: false, error: "sheet not found for gid " + String(gid) };

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: false, error: "no data rows below header" };

  var targetRow = findPlotRow_(sh, plotNo);
  if (targetRow < 0) return { ok: false, error: "plot not found: " + plotNo };

  var written = [];
  var keys = Object.keys(updates);
  for (var ki = 0; ki < keys.length; ki++) {
    var key = keys[ki];
    var col = findColByHeaderKey_(sh, String(key));
    if (col < 1) continue;
    sh.getRange(targetRow, col).setValue(updates[key]);
    written.push(key);
  }
  return { ok: true, row: targetRow, columns: written };
}

function doPost(e) {
  try {
    const body = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    const data = JSON.parse(body);

    if (!data || data.apiKey !== SCRIPT_API_KEY) {
      return json_({ ok: false, error: "unauthorized" }, 401);
    }

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const action = String(data.action || "");

    // Shared portal backend
    if (action === "state") {
      return json_(getPortalState_(ss), 200);
    }
    if (action === "submitPaymentRequest") {
      var sh = ensureSheetWithHeaders_(ss, PORTAL_PENDING_SHEET, PORTAL_PENDING_HEADERS);
      var plotNo = String(data.plotNo || "").trim();
      var ym = normalizeYm_(data.ym);
      var mob = String(data.requesterMobile || "").trim();
      var amount = Number(data.amount || 0);
      var lateFee = Number(data.lateFee || 0);
      if (!plotNo || !ym || !mob) return json_({ ok:false, error:"plotNo, ym, requesterMobile required" }, 400);
      if (amount <= 0 && lateFee <= 0) return json_({ ok:false, error:"amount or lateFee required" }, 400);
      var paySh = ensureSheetWithHeaders_(ss, PORTAL_PAYMENTS_SHEET, PORTAL_PAYMENTS_HEADERS);
      if (paymentExists_(paySh, plotNo, ym)) return json_({ ok:false, error:"already_paid" }, 409);
      var items = rowsToObjects_(sh, PORTAL_PENDING_HEADERS);
      for (var i = 0; i < items.length; i++) {
        if (String(items[i].plotNo) === plotNo && String(items[i].ym) === ym && String(items[i].requesterMobile) === mob) {
          return json_({ ok:true, id: items[i].id, updated: true }, 200);
        }
      }
      var id = newId_();
      sh.appendRow([id, plotNo, ym, amount, lateFee, mob, Date.now()]);
      audit_(ss, mob, "submitPaymentRequest", { id:id, plotNo:plotNo, ym:ym, amount:amount, lateFee:lateFee });
      invalidatePortalStateCache_();
      return json_({ ok:true, id:id }, 200);
    }
    if (action === "approvePaymentRequest") {
      var idA = String(data.id || "").trim();
      var actor = String(data.actor || "admin").trim();
      if (!idA) return json_({ ok:false, error:"id required" }, 400);
      var pendSh = ensureSheetWithHeaders_(ss, PORTAL_PENDING_SHEET, PORTAL_PENDING_HEADERS);
      var pend = rowsToObjects_(pendSh, PORTAL_PENDING_HEADERS);
      var req = null;
      for (var pi = 0; pi < pend.length; pi++) if (String(pend[pi].id) === idA) { req = pend[pi]; break; }
      if (!req) return json_({ ok:false, error:"not_found" }, 404);
      var paySh2 = ensureSheetWithHeaders_(ss, PORTAL_PAYMENTS_SHEET, PORTAL_PAYMENTS_HEADERS);
      if (paymentExists_(paySh2, req.plotNo, req.ym)) {
        deleteWhere_(pendSh, function(row){ return String(row[0]) === idA; });
        audit_(ss, actor, "approvePaymentRequest_stale", { id:idA, plotNo:req.plotNo, ym:req.ym });
        return json_({ ok:false, error:"already_paid" }, 409);
      }
      var payId = newId_();
      var ymA = normalizeYm_(req.ym);
      paySh2.appendRow([payId, nowIso_(), String(req.plotNo || "").trim(), ymA, Number(req.amount || 0), Number(req.lateFee || 0), "admin", "approved_owner_request", "approved", String(req.requesterMobile || "")]);
      deleteWhere_(pendSh, function(row){ return String(row[0]) === idA; });
      // Also append to collection_data/month tab so the main sheet reflects it reliably.
      appendCollectionRow_(ss, {
        atIso: nowIso_(),
        plotNo: req.plotNo,
        ym: ymA,
        monthLabel: ymA,
        amount: Number(req.amount || 0),
        lateFee: Number(req.lateFee || 0),
        role: "admin",
        ownerName: "",
        mobile: String(req.requesterMobile || ""),
        groupStatus: "",
        userAgent: "",
        note: "approved_owner_request_server"
      });
      audit_(ss, actor, "approvePaymentRequest", { id:idA, paymentId:payId, plotNo:req.plotNo, ym:req.ym });
      invalidatePortalStateCache_();
      return json_({ ok:true, paymentId: payId }, 200);
    }
    if (action === "rejectPaymentRequest") {
      var idR = String(data.id || "").trim();
      var actorR = String(data.actor || "admin").trim();
      if (!idR) return json_({ ok:false, error:"id required" }, 400);
      var pendSh2 = ensureSheetWithHeaders_(ss, PORTAL_PENDING_SHEET, PORTAL_PENDING_HEADERS);
      var removed = deleteWhere_(pendSh2, function(row){ return String(row[0]) === idR; });
      audit_(ss, actorR, "rejectPaymentRequest", { id:idR, removed:removed });
      invalidatePortalStateCache_();
      return json_({ ok:true, removed:removed }, 200);
    }
    if (action === "addPayment") {
      var actorP = String(data.actor || "admin").trim();
      var plotNoP = String(data.plotNo || "").trim();
      var ymP = normalizeYm_(data.ym);
      var amountP = Number(data.amount || 0);
      var lateFeeP = Number(data.lateFee || 0);
      if (!plotNoP || !ymP) return json_({ ok:false, error:"plotNo and ym required" }, 400);
      if (amountP <= 0 && lateFeeP <= 0) return json_({ ok:false, error:"amount or lateFee required" }, 400);
      var paySh3 = ensureSheetWithHeaders_(ss, PORTAL_PAYMENTS_SHEET, PORTAL_PAYMENTS_HEADERS);
      if (paymentExists_(paySh3, plotNoP, ymP)) return json_({ ok:false, error:"already_paid" }, 409);
      var pid = newId_();
      paySh3.appendRow([pid, nowIso_(), plotNoP, ymP, amountP, lateFeeP, "admin", "admin", "admin_portal_save", ""]);
      // Also append to collection_data/month tab so the main sheet reflects it reliably.
      appendCollectionRow_(ss, {
        atIso: nowIso_(),
        plotNo: plotNoP,
        ym: ymP,
        monthLabel: ymP,
        amount: amountP,
        lateFee: lateFeeP,
        role: "admin",
        ownerName: "",
        mobile: "",
        groupStatus: "",
        userAgent: "",
        note: "admin_portal_save_server"
      });
      audit_(ss, actorP, "addPayment", { paymentId:pid, plotNo:plotNoP, ym:ymP, amount:amountP, lateFee:lateFeeP });
      invalidatePortalStateCache_();
      return json_({ ok:true, paymentId: pid }, 200);
    }
    if (action === "deletePaymentsForMonths") {
      var actorDel = String(data.actor || "admin").trim();
      var plotDel = String(data.plotNo || "").trim();
      var yms = Array.isArray(data.yms) ? data.yms.map(function(x){ return normalizeYm_(x); }) : [];
      if (!plotDel || !yms.length) return json_({ ok:false, error:"plotNo and yms[] required" }, 400);
      var setYm = {};
      for (var yi = 0; yi < yms.length; yi++) setYm[String(yms[yi])] = true;
      var payShDel = ensureSheetWithHeaders_(ss, PORTAL_PAYMENTS_SHEET, PORTAL_PAYMENTS_HEADERS);
      var removed = deleteWhere_(payShDel, function(row){
        // headers: id, atIso, plotNo, ym, ... — ym column may be Date-formatted in Sheets.
        return String(row[2]).trim() === plotDel && !!setYm[ymCellToCanon_(ss, row[3])];
      });
      var removedLogs = deleteCollectionRowsForPlotMonths_(ss, plotDel, yms);
      audit_(ss, actorDel, "deletePaymentsForMonths", {
        deletedAtIso: nowIso_(),
        plotNo: plotDel,
        yms: yms,
        removedPortalPaymentRows: removed,
        removedCollectionAndMonthTabRows: removedLogs
      });
      invalidatePortalStateCache_();
      return json_({ ok:true, removed: removed, removedLogs: removedLogs }, 200);
    }
    if (action === "createTicket") {
      var tSh = ensureSheetWithHeaders_(ss, PORTAL_TICKETS_SHEET, PORTAL_TICKETS_HEADERS);
      var idT = newId_();
      var plotT = String(data.plotNo || "").trim();
      var mobT = String(data.requesterMobile || "").trim();
      var cat = String(data.category || "").trim();
      var desc = String(data.description || "").trim();
      if (!mobT || !desc) return json_({ ok:false, error:"requesterMobile and description required" }, 400);
      tSh.appendRow([idT, plotT, mobT, cat, desc, "open", Date.now(), Date.now(), ""]);
      audit_(ss, mobT, "createTicket", { id:idT, plotNo:plotT, category:cat });
      invalidatePortalStateCache_();
      return json_({ ok:true, id:idT }, 200);
    }
    if (action === "updateTicket") {
      var idU = String(data.id || "").trim();
      var statusU = String(data.status || "").trim();
      var commentU = String(data.adminComment || "").trim();
      var actorU = String(data.actor || "admin").trim();
      if (!idU) return json_({ ok:false, error:"id required" }, 400);
      var tSh2 = ensureSheetWithHeaders_(ss, PORTAL_TICKETS_SHEET, PORTAL_TICKETS_HEADERS);
      var rows = rowsToObjects_(tSh2, PORTAL_TICKETS_HEADERS);
      var found = null;
      for (var ri = 0; ri < rows.length; ri++) if (String(rows[ri].id) === idU) { found = rows[ri]; break; }
      if (!found) return json_({ ok:false, error:"not_found" }, 404);
      if (statusU) found.status = statusU;
      if (commentU) found.adminComment = commentU;
      found.updatedAt = Date.now();
      upsertById_(tSh2, PORTAL_TICKETS_HEADERS, idU, found);
      audit_(ss, actorU, "updateTicket", { id:idU, status:statusU });
      invalidatePortalStateCache_();
      return json_({ ok:true }, 200);
    }
    if (action === "createNotice") {
      var nSh = ensureSheetWithHeaders_(ss, PORTAL_NOTICES_SHEET, PORTAL_NOTICES_HEADERS);
      var idN = newId_();
      var title = String(data.title || "").trim();
      var bodyN = String(data.body || "").trim();
      var aud = String(data.audience || "all").trim();
      var by = String(data.createdBy || "admin").trim();
      var att = String(data.attachmentUrl || "").trim();
      if (!title || !bodyN) return json_({ ok:false, error:"title and body required" }, 400);
      nSh.appendRow([idN, title, bodyN, aud, Date.now(), by, att]);
      audit_(ss, by, "createNotice", { id:idN, title:title });
      invalidatePortalStateCache_();
      return json_({ ok:true, id:idN }, 200);
    }
    if (action === "deleteNotice") {
      var idD = String(data.id || "").trim();
      var actorD = String(data.actor || "admin").trim();
      if (!idD) return json_({ ok:false, error:"id required" }, 400);
      var nSh2 = ensureSheetWithHeaders_(ss, PORTAL_NOTICES_SHEET, PORTAL_NOTICES_HEADERS);
      var removedN = deleteWhere_(nSh2, function(row){ return String(row[0]) === idD; });
      audit_(ss, actorD, "deleteNotice", { id:idD, removed:removedN });
      invalidatePortalStateCache_();
      return json_({ ok:true, removed:removedN }, 200);
    }

    if (action === "bulk") {
      const entries = data.entries;
      if (!Array.isArray(entries)) {
        return json_({ ok: false, error: "entries must be an array" }, 400);
      }
      var count = 0;
      for (var i = 0; i < entries.length; i++) {
        appendCollectionRow_(ss, entries[i] || {});
        count++;
      }
      return json_({ ok: true, count: count });
    }

    if (action === "updatePlotRow") {
      var ur = updatePlotRowInSheet_(ss, data);
      return json_(ur, ur.ok ? 200 : 400);
    }

    if (action === "upsertPlotRow") {
      var pr = upsertPlotRowInSheet_(ss, data);
      return json_(pr, pr.ok ? 200 : 400);
    }

    var entry = data.entry;
    if (entry && typeof entry === "object") {
      appendCollectionRow_(ss, entry);
      return json_({ ok: true });
    }

    return json_({ ok: false, error: "missing entry or unknown action" }, 400);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) }, 500);
  }
}
