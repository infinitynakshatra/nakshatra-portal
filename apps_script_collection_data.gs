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
 * 4) Each row is also copied to a year tab: collection_y_YYYY
 *      e.g. ym "2025-04" -> tab name "collection_y_2025"
 *    Legacy month tabs collection_m_YYYYMM are still read if present (not created for new rows).
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
/** Prefix for per-year backup tabs (ym format YYYY-MM in portal). */
const YEAR_TAB_PREFIX = "collection_y_";
/** Legacy month tabs — read-only for old data; no longer created on write. */
const MONTH_TAB_PREFIX = "collection_m_";

// Portal backend tabs (shared across devices)
const PORTAL_PAYMENTS_SHEET = "portal_payments";
const PORTAL_PENDING_SHEET = "portal_pending_requests";
const PORTAL_TICKETS_SHEET = "portal_tickets";
const PORTAL_NOTICES_SHEET = "portal_notices";
const PORTAL_AUDIT_SHEET = "portal_audit";
/** Single-row JSON for society banking/UPI (shared across devices). */
const PORTAL_BANKING_SHEET = "portal_banking_config";
const PORTAL_BANKING_HEADERS = ["key", "jsonPayload"];
const PORTAL_PROJECT_DOCS_SHEET = "portal_project_docs";
const PORTAL_PROJECT_DOCS_HEADERS = ["key", "jsonPayload"];
const PORTAL_MEETING_DOCS_SHEET = "portal_meeting_docs";
const PORTAL_MEETING_DOCS_HEADERS = ["key", "jsonPayload"];
const PORTAL_SOCIETY_DETAILS_SHEET = "portal_society_details";
const PORTAL_SOCIETY_DETAILS_HEADERS = ["key", "jsonPayload"];
const PORTAL_SERVICE_CONTACTS_SHEET = "portal_service_contacts";
const PORTAL_SERVICE_CONTACTS_HEADERS = ["key", "jsonPayload"];
const PORTAL_OWNER_ACCESS_SHEET = "portal_owner_access";
const PORTAL_OWNER_ACCESS_HEADERS = ["key", "jsonPayload"];
/** Per-user (or broadcast "*") messages shown on the owner portal. */
const PORTAL_USER_INBOX_SHEET = "portal_user_inbox";
const PORTAL_USER_INBOX_HEADERS = ["id", "atIso", "toMobile", "kind", "title", "body", "readAt"];

const PORTAL_PAYMENTS_HEADERS = ["id","atIso","plotNo","ym","amount","lateFee","by","source","note","requesterMobile"];
const PORTAL_PENDING_HEADERS = ["id","plotNo","ym","amount","lateFee","requesterMobile","requestedAt"];
const PORTAL_TICKETS_HEADERS = ["id","plotNo","requesterMobile","category","description","status","createdAt","updatedAt","adminComment"];
const PORTAL_NOTICES_HEADERS = ["id","title","body","audience","createdAt","createdBy","attachmentUrl"];
const PORTAL_AUDIT_HEADERS = ["atIso","actor","action","detail"];
const PORTAL_EXPENSES_SHEET = "portal_expenses";
const PORTAL_EXPENSES_HEADERS = ["id","atIso","ym","category","amount","description","paidTo"];
/** Visitor log at society gate (watchman entries; photo stored in Drive when available). */
const PORTAL_GATE_VISITS_SHEET = "portal_my_gate_visitors";
const PORTAL_GATE_VISITS_HEADERS = ["id","atIso","plotNo","ownerMobile","visitorName","visitorMobile","vehicle","purpose","photoUrl"];
/** Tab gids for plot→owner phone lookup (same order as portal SHEET_EXPORT_GIDS: first tab then plot_owners). */
var PORTAL_OWNER_PLOT_SHEET_GIDS = [0, 1304899070];
/** Fallback phone columns when Primary Contact Number is empty (10-digit mobile required for inbox). */
var OWNER_PHONE_ALT_HEADERS = [
  "Alternate Contact Number",
  "Alternate Number",
  "Alternate Mobile",
  "Secondary Contact Number"
];
/** Single cell: May-start calendar year for the FY shown on the owner portal (shared across devices). */
const PORTAL_FY_SETTINGS_SHEET = "portal_fy_settings";
const PORTAL_FY_SETTINGS_HEADERS = ["ownerPortalMayYear"];

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
  if (!s) return "";
  var isoDay = s.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (isoDay) return isoDay[1] + "-" + isoDay[2];
  var m = s.match(/^(\d{4})-(\d{1,2})$/);
  if (m) return m[1] + "-" + String(m[2]).padStart(2, "0");
  var m6 = s.match(/^(\d{4})(\d{2})$/);
  if (m6) return m6[1] + "-" + m6[2];
  var mon3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var cleaned = s.replace(/['\u2019]/g, "-").replace(/\s+/g, "");
  var head = cleaned.slice(0, 3);
  var mi = -1;
  for (var i = 0; i < mon3.length; i++) {
    if (mon3[i].toLowerCase() === head.toLowerCase()) { mi = i; break; }
  }
  if (mi >= 0) {
    var tail = cleaned.slice(3).replace(/^-+/, "");
    var yy = tail.match(/^(\d{2}|\d{4})$/);
    if (yy) {
      var yNum = Number(yy[1]);
      if (!Number.isFinite(yNum)) return s;
      if (yNum < 100) yNum += 2000;
      return yNum + "-" + String(mi + 1).padStart(2, "0");
    }
  }
  return s;
}

/** Find 0-based column index from row-1 header labels (case/spacing insensitive). */
function headerColIndex_(headerRow, aliases) {
  for (var c = 0; c < headerRow.length; c++) {
    var h = String(headerRow[c] || "").trim().toLowerCase().replace(/\s+/g, " ");
    for (var a = 0; a < aliases.length; a++) {
      if (h === String(aliases[a]).toLowerCase()) return c;
    }
  }
  return -1;
}

function collectionSheetPaymentCols_(headerRow) {
  return {
    atIdx: (function () {
      var i = headerColIndex_(headerRow, ["atiso", "at iso", "timestamp", "date"]);
      return i >= 0 ? i : 0;
    })(),
    plotIdx: (function () {
      var i = headerColIndex_(headerRow, ["plotno", "plot no", "plot no.", "plot number"]);
      return i >= 0 ? i : 1;
    })(),
    ymIdx: (function () {
      var i = headerColIndex_(headerRow, ["ym", "year-month", "year month", "month"]);
      return i >= 0 ? i : 2;
    })(),
    amtIdx: (function () {
      var i = headerColIndex_(headerRow, ["amount", "maintenance", "maintenance amount", "mc amount"]);
      return i >= 0 ? i : 4;
    })(),
    lateIdx: (function () {
      var i = headerColIndex_(headerRow, ["latefee", "late fee", "late fee amount"]);
      return i >= 0 ? i : 5;
    })(),
    roleIdx: (function () {
      var i = headerColIndex_(headerRow, ["role", "by"]);
      return i >= 0 ? i : 6;
    })(),
    noteIdx: (function () {
      var i = headerColIndex_(headerRow, ["note"]);
      return i >= 0 ? i : 11;
    })()
  };
}

function rowToCollectionPayment_(ss, r, cols) {
  var plotNo = String(r[cols.plotIdx] != null ? r[cols.plotIdx] : "").trim();
  var ym = portalYmCanon_(ss, r[cols.ymIdx]);
  if (!plotNo || !ym || !/^\d{4}-\d{2}$/.test(ym)) return null;
  var amount = Number(r[cols.amtIdx] || 0);
  var lateFee = Number(r[cols.lateIdx] || 0);
  if (!(amount > 0) && !(lateFee > 0)) return null;
  return {
    id: "",
    atIso: String(r[cols.atIdx] != null ? r[cols.atIdx] : ""),
    plotNo: plotNo,
    ym: ym,
    amount: amount,
    lateFee: lateFee,
    by: String(r[cols.roleIdx] != null ? r[cols.roleIdx] : ""),
    source: "collection_data",
    note: String(r[cols.noteIdx] != null ? r[cols.noteIdx] : ""),
    requesterMobile: ""
  };
}

function paymentsFromCollectionSheet_(sh, ss) {
  if (!sh) return [];
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = Math.max(sh.getLastColumn(), COLLECTION_HEADERS.length);
  var headerRow = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var cols = collectionSheetPaymentCols_(headerRow);
  var start = Math.max(2, lastRow - 4999);
  var vals = sh.getRange(start, 1, lastRow, lastCol).getValues();
  var map = {};
  var i;
  for (i = 0; i < vals.length; i++) {
    var row = rowToCollectionPayment_(ss, vals[i], cols);
    if (!row) continue;
    var key = portalPaymentKey_(row.plotNo, row.ym);
    map[key] = pickBetterPortalPayment_(map[key], row);
  }
  var out = [];
  for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) out.push(map[k]);
  return out;
}

function paymentsFromBackupTabs_(ss) {
  var sheets = ss.getSheets();
  var map = {};
  var si;
  for (si = 0; si < sheets.length; si++) {
    var sh = sheets[si];
    var name = String(sh.getName() || "");
    if (name.indexOf(YEAR_TAB_PREFIX) !== 0 && name.indexOf(MONTH_TAB_PREFIX) !== 0) continue;
    var rows = paymentsFromCollectionSheet_(sh, ss);
    var i;
    for (i = 0; i < rows.length; i++) {
      var row = rows[i];
      var k = portalPaymentKey_(row.plotNo, row.ym);
      map[k] = pickBetterPortalPayment_(map[k], row);
    }
  }
  var out = [];
  for (var k in map) if (Object.prototype.hasOwnProperty.call(map, k)) out.push(map[k]);
  return out;
}

function readPortalPayments_(ss) {
  var sh = ensureSheetWithHeaders_(ss, PORTAL_PAYMENTS_SHEET, PORTAL_PAYMENTS_HEADERS);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var lastCol = Math.max(sh.getLastColumn(), PORTAL_PAYMENTS_HEADERS.length);
  var headerRow = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var col = {};
  var fieldAliases = {
    id: ["id"],
    atIso: ["atiso", "at iso"],
    plotNo: ["plotno", "plot no", "plot no."],
    ym: ["ym", "year-month", "year month"],
    amount: ["amount", "maintenance", "maintenance amount"],
    lateFee: ["latefee", "late fee"],
    by: ["by", "role"],
    source: ["source"],
    note: ["note"],
    requesterMobile: ["requestermobile", "requester mobile", "mobile"]
  };
  var fi;
  for (fi = 0; fi < PORTAL_PAYMENTS_HEADERS.length; fi++) {
    var field = PORTAL_PAYMENTS_HEADERS[fi];
    var idx = headerColIndex_(headerRow, fieldAliases[field] || [field.toLowerCase()]);
    col[field] = idx >= 0 ? idx : fi;
  }
  var vals = sh.getRange(2, 1, lastRow, lastCol).getValues();
  var out = [];
  var r;
  for (r = 0; r < vals.length; r++) {
    var row = vals[r];
    var plotNo = String(row[col.plotNo] != null ? row[col.plotNo] : "").trim();
    var ym = portalYmCanon_(ss, row[col.ym]);
    if (!plotNo || !ym || !/^\d{4}-\d{2}$/.test(ym)) continue;
    var amount = Number(row[col.amount] || 0);
    var lateFee = Number(row[col.lateFee] || 0);
    if (!(amount > 0) && !(lateFee > 0)) continue;
    out.push({
      id: String(row[col.id] != null ? row[col.id] : ""),
      atIso: String(row[col.atIso] != null ? row[col.atIso] : ""),
      plotNo: plotNo,
      ym: ym,
      amount: amount,
      lateFee: lateFee,
      by: String(row[col.by] != null ? row[col.by] : ""),
      source: String(row[col.source] != null ? row[col.source] : ""),
      note: String(row[col.note] != null ? row[col.note] : ""),
      requesterMobile: String(row[col.requesterMobile] != null ? row[col.requesterMobile] : "")
    });
  }
  return out;
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

/** Canonical YYYY-MM for portal logic (handles Sheet Date cells in pending / collection rows). */
function portalYmCanon_(ss, ymVal) {
  return normalizeYm_(ymCellToCanon_(ss, ymVal));
}

/** plotNo|ym for de-duplicating merged payment rows */
function portalPaymentKey_(plotNo, ym) {
  return String(plotNo || "").trim() + "|" + normalizeYm_(ym);
}

/** One row's money for comparisons/totals: if amount and lateFee are the same positive value, count once (mirrored columns). */
function paymentLineMoneyTotal_(row) {
  if (!row) return 0;
  var a = Number(row.amount || 0);
  var lf = Number(row.lateFee || 0);
  if (a > 0 && lf > 0 && Math.abs(a - lf) < 0.005) return a;
  return a + lf;
}

/** When two records exist for the same plot+month, prefer real money + latest timestamp. */
function pickBetterPortalPayment_(a, b) {
  if (!a) return b;
  if (!b) return a;
  var aa = paymentLineMoneyTotal_(a);
  var bb = paymentLineMoneyTotal_(b);
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
    map[k] = pickBetterPortalPayment_(map[k], pr);
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

function sanitizeBankingPayload_(data) {
  var keys = ["primaryAccountHolder", "secondaryAccountHolder", "beneficiaryName", "bankName", "accountNumber", "accountType", "ifsc", "upiId", "guidelines", "qrDataUrl"];
  var o = {};
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    o[k] = String(data && data[k] != null ? data[k] : "").trim();
  }
  if (o.ifsc) o.ifsc = o.ifsc.toUpperCase();
  return o;
}

function readPortalExpenses_(ss) {
  var sh = ensureSheetWithHeaders_(ss, PORTAL_EXPENSES_SHEET, PORTAL_EXPENSES_HEADERS);
  var rows = rowsToObjects_(sh, PORTAL_EXPENSES_HEADERS);
  var out = [];
  var i;
  for (i = 0; i < rows.length; i++) {
    var r = rows[i];
    var idRaw = String(r.id || "").trim();
    if (!idRaw || idRaw.toLowerCase() === "null") continue;
    out.push({
      id: idRaw,
      atIso: String(r.atIso || ""),
      ym: portalYmCanon_(ss, r.ym),
      category: String(r.category || ""),
      amount: Number(r.amount || 0),
      description: String(r.description || ""),
      paidTo: String(r.paidTo || "")
    });
  }
  return out;
}

function readPortalOwnerFyMayYear_(ss) {
  var sh = ensureSheetWithHeaders_(ss, PORTAL_FY_SETTINGS_SHEET, PORTAL_FY_SETTINGS_HEADERS);
  if (sh.getLastRow() < 2) return null;
  var v = sh.getRange(2, 1).getValue();
  var n = Number(v);
  if (!isFinite(n) || n < 2000 || n > 2100) return null;
  return Math.round(n);
}

function writePortalOwnerFyMayYear_(ss, mayYear) {
  var n = Math.round(Number(mayYear));
  if (!isFinite(n) || n < 2000 || n > 2100) return { ok: false, error: "invalid ownerPortalMayYear" };
  var sh = ensureSheetWithHeaders_(ss, PORTAL_FY_SETTINGS_SHEET, PORTAL_FY_SETTINGS_HEADERS);
  var row = [n];
  if (sh.getLastRow() < 2) sh.appendRow(row);
  else sh.getRange(2, 1, 1, 1).setValues([row]);
  return { ok: true };
}

function readPortalGateVisits_(ss) {
  var sh = ensureSheetWithHeaders_(ss, PORTAL_GATE_VISITS_SHEET, PORTAL_GATE_VISITS_HEADERS);
  var rows = rowsToObjects_(sh, PORTAL_GATE_VISITS_HEADERS);
  rows.sort(function (a, b) {
    return String(b.atIso || "").localeCompare(String(a.atIso || ""));
  });
  return rows.slice(0, 400);
}

function findPortalGateVisitRowNum_(ss, id) {
  var want = String(id || "").trim();
  if (!want) return -1;
  var sh = ss.getSheetByName(PORTAL_GATE_VISITS_SHEET);
  if (!sh || sh.getLastRow() < 2) return -1;
  var lr = sh.getLastRow();
  var ids = sh.getRange(2, 1, lr, 1).getDisplayValues();
  var i;
  for (i = 0; i < ids.length; i++) {
    if (String(ids[i][0] || "").trim() === want) return i + 2;
  }
  return -1;
}

function plotNoCellMatchesPlotInput_(cellVal, plotInput) {
  var a = String(cellVal != null ? cellVal : "").trim();
  var b = String(plotInput || "").trim();
  if (!a || !b) return false;
  if (a === b) return true;
  var na = Number(a);
  var nb = Number(b);
  if (isFinite(na) && isFinite(nb) && na === nb) return true;
  return false;
}

function rowTenDigitPhoneFromCol_(sh, row, col) {
  if (col < 1) return null;
  var v = String(sh.getRange(row, col).getDisplayValue() || "").trim();
  var digits = v.replace(/\D/g, "");
  if (digits.length < 10) return null;
  return digits.slice(-10);
}

function lookupPrimaryMobileDigitsForPlot_(ss, plotNo) {
  var want = String(plotNo || "").trim();
  if (!want) return null;
  var gi;
  for (gi = 0; gi < PORTAL_OWNER_PLOT_SHEET_GIDS.length; gi++) {
    var sh;
    try {
      sh = ss.getSheetById(PORTAL_OWNER_PLOT_SHEET_GIDS[gi]);
    } catch (e1) {
      continue;
    }
    if (!sh) continue;
    var plotCol = findColByHeaderKey_(sh, "Plot No.");
    if (plotCol < 1) continue;
    var primaryCol = findColByHeaderKey_(sh, "Primary Contact Number");
    var lastRow = sh.getLastRow();
    var r;
    for (r = 2; r <= lastRow; r++) {
      var cellPlot = sh.getRange(r, plotCol).getDisplayValue();
      if (!plotNoCellMatchesPlotInput_(cellPlot, want)) continue;
      var dig = rowTenDigitPhoneFromCol_(sh, r, primaryCol);
      if (dig) return dig;
      var ai;
      for (ai = 0; ai < OWNER_PHONE_ALT_HEADERS.length; ai++) {
        var ac = findColByHeaderKey_(sh, OWNER_PHONE_ALT_HEADERS[ai]);
        dig = rowTenDigitPhoneFromCol_(sh, r, ac);
        if (dig) return dig;
      }
      return null;
    }
  }
  return null;
}

function ownerMobileDigitsFromRow_(sh, row) {
  var primaryCol = findColByHeaderKey_(sh, "Primary Contact Number");
  var dig = rowTenDigitPhoneFromCol_(sh, row, primaryCol);
  if (dig) return dig;
  var ai;
  for (ai = 0; ai < OWNER_PHONE_ALT_HEADERS.length; ai++) {
    var ac = findColByHeaderKey_(sh, OWNER_PHONE_ALT_HEADERS[ai]);
    dig = rowTenDigitPhoneFromCol_(sh, row, ac);
    if (dig) return dig;
  }
  return null;
}

function readPortalBankingObject_(ss) {
  var sh = ensureSheetWithHeaders_(ss, PORTAL_BANKING_SHEET, PORTAL_BANKING_HEADERS);
  if (sh.getLastRow() < 2) return null;
  var cell = sh.getRange(2, 2).getValue();
  var s = String(cell || "").trim();
  if (!s) return null;
  try {
    var o = JSON.parse(s);
    return o && typeof o === "object" ? sanitizeBankingPayload_(o) : null;
  } catch (e) {
    return null;
  }
}

function writePortalBankingObject_(ss, data) {
  var obj = sanitizeBankingPayload_(data);
  var sh = ensureSheetWithHeaders_(ss, PORTAL_BANKING_SHEET, PORTAL_BANKING_HEADERS);
  var payload = JSON.stringify(obj);
  if (payload.length > 48000) return { ok: false, error: "banking_payload_too_large" };
  var row = ["default", payload];
  if (sh.getLastRow() < 2) sh.appendRow(row);
  else sh.getRange(2, 1, 1, 2).setValues([row]);
  return { ok: true };
}

function sanitizeProjectDocsList_(docs) {
  var out = [];
  var arr = Array.isArray(docs) ? docs : [];
  for (var i = 0; i < arr.length && i < 300; i++) {
    var d = arr[i];
    if (!d) continue;
    var id = String(d.id || "").trim();
    var name = String(d.name || "").trim().slice(0, 500);
    if (!id || !name) continue;
    out.push({
      id: id,
      name: name,
      details: String(d.details || "").slice(0, 4000),
      url: String(d.url || "").trim().slice(0, 2000),
      likeCount: Math.max(0, Number(d.likeCount) || 0),
      createdAt: Number(d.createdAt) || 0
    });
  }
  return out;
}

function readPortalProjectDocs_(ss) {
  var sh = ss.getSheetByName(PORTAL_PROJECT_DOCS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var cell = sh.getRange(2, 2).getValue();
  var s = String(cell || "").trim();
  if (!s) return [];
  try {
    var o = JSON.parse(s);
    var arr = o && Array.isArray(o.docs) ? o.docs : [];
    return sanitizeProjectDocsList_(arr);
  } catch (e) {
    return [];
  }
}

function writePortalProjectDocs_(ss, docs) {
  var sh = ensureSheetWithHeaders_(ss, PORTAL_PROJECT_DOCS_SHEET, PORTAL_PROJECT_DOCS_HEADERS);
  var clean = sanitizeProjectDocsList_(docs);
  var payload = JSON.stringify({ v: 1, docs: clean });
  if (payload.length > 48000) return { ok: false, error: "project_docs_payload_too_large" };
  var row = ["default", payload];
  if (sh.getLastRow() < 2) sh.appendRow(row);
  else sh.getRange(2, 1, 1, 2).setValues([row]);
  return { ok: true };
}

function readPortalMeetingDocs_(ss) {
  var sh = ss.getSheetByName(PORTAL_MEETING_DOCS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var cell = sh.getRange(2, 2).getValue();
  var s = String(cell || "").trim();
  if (!s) return [];
  try {
    var o = JSON.parse(s);
    var arr = o && Array.isArray(o.docs) ? o.docs : [];
    return sanitizeProjectDocsList_(arr);
  } catch (e) {
    return [];
  }
}

function writePortalMeetingDocs_(ss, docs) {
  var sh = ensureSheetWithHeaders_(ss, PORTAL_MEETING_DOCS_SHEET, PORTAL_MEETING_DOCS_HEADERS);
  var clean = sanitizeProjectDocsList_(docs);
  var payload = JSON.stringify({ v: 1, docs: clean });
  if (payload.length > 48000) return { ok: false, error: "meeting_docs_payload_too_large" };
  var row = ["default", payload];
  if (sh.getLastRow() < 2) sh.appendRow(row);
  else sh.getRange(2, 1, 1, 2).setValues([row]);
  return { ok: true };
}

function sanitizeSocietyMemberList_(arr, fields) {
  var out = [];
  var list = Array.isArray(arr) ? arr : [];
  for (var i = 0; i < list.length && i < 80; i++) {
    var m = list[i];
    if (!m) continue;
    var id = String(m.id || "").trim();
    var name = String(m.name || "").trim().slice(0, 200);
    if (!id || !name) continue;
    var row = { id: id, name: name };
    if (fields.indexOf("plotNo") >= 0) row.plotNo = String(m.plotNo || "").trim().slice(0, 40);
    if (fields.indexOf("plotHouseNo") >= 0) row.plotHouseNo = String(m.plotHouseNo || "").trim().slice(0, 40);
    if (fields.indexOf("mobile") >= 0) row.mobile = String(m.mobile || "").trim().slice(0, 30);
    if (fields.indexOf("role") >= 0) row.role = String(m.role || "").trim().slice(0, 120);
    if (fields.indexOf("responsibility") >= 0) row.responsibility = String(m.responsibility || "").slice(0, 2000);
    out.push(row);
  }
  return out;
}

function sanitizeSocietyDetails_(o) {
  var x = o && typeof o === "object" ? o : {};
  return {
    projectStartedDate: String(x.projectStartedDate || "").trim().slice(0, 10),
    adhocFormationDate: String(x.adhocFormationDate || "").trim().slice(0, 10),
    endOfAdhocTenureDate: String(x.endOfAdhocTenureDate || "").trim().slice(0, 10),
    adhocMembers: sanitizeSocietyMemberList_(x.adhocMembers, ["plotNo", "mobile"]),
    societyFormationDate: String(x.societyFormationDate || "").trim().slice(0, 10),
    societyRegistrationNumber: String(x.societyRegistrationNumber || "").trim().slice(0, 200),
    gbFromDate: String(x.gbFromDate || "").trim().slice(0, 10),
    gbToDate: String(x.gbToDate || "").trim().slice(0, 10),
    gbMembers: sanitizeSocietyMemberList_(x.gbMembers, ["plotHouseNo", "role", "responsibility", "mobile"])
  };
}

function readPortalSocietyDetails_(ss) {
  var sh = ss.getSheetByName(PORTAL_SOCIETY_DETAILS_SHEET);
  if (!sh || sh.getLastRow() < 2) return sanitizeSocietyDetails_({});
  var cell = sh.getRange(2, 2).getValue();
  var s = String(cell || "").trim();
  if (!s) return sanitizeSocietyDetails_({});
  try {
    var o = JSON.parse(s);
    return sanitizeSocietyDetails_(o && o.details ? o.details : o);
  } catch (e) {
    return sanitizeSocietyDetails_({});
  }
}

function writePortalSocietyDetails_(ss, details) {
  var sh = ensureSheetWithHeaders_(ss, PORTAL_SOCIETY_DETAILS_SHEET, PORTAL_SOCIETY_DETAILS_HEADERS);
  var clean = sanitizeSocietyDetails_(details);
  var payload = JSON.stringify({ v: 1, details: clean });
  if (payload.length > 48000) return { ok: false, error: "society_details_payload_too_large" };
  var row = ["default", payload];
  if (sh.getLastRow() < 2) sh.appendRow(row);
  else sh.getRange(2, 1, 1, 2).setValues([row]);
  return { ok: true };
}

function sanitizeServiceContactsList_(rows) {
  var out = [];
  var arr = Array.isArray(rows) ? rows : [];
  for (var i = 0; i < arr.length && i < 300; i++) {
    var r = arr[i];
    if (!r) continue;
    var id = String(r.id || "").trim();
    var contactName = String(r.contactName || "").trim().slice(0, 500);
    if (!id || !contactName) continue;
    out.push({
      id: id,
      contactName: contactName,
      contact: String(r.contact || "").trim().slice(0, 500),
      serviceDetails: String(r.serviceDetails || "").slice(0, 4000),
      createdAt: Number(r.createdAt) || 0
    });
  }
  return out;
}

function readPortalServiceContacts_(ss) {
  var sh = ss.getSheetByName(PORTAL_SERVICE_CONTACTS_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var cell = sh.getRange(2, 2).getValue();
  var s = String(cell || "").trim();
  if (!s) return [];
  try {
    var o = JSON.parse(s);
    var arr = o && Array.isArray(o.contacts) ? o.contacts : [];
    return sanitizeServiceContactsList_(arr);
  } catch (e) {
    return [];
  }
}

function writePortalServiceContacts_(ss, contacts) {
  var sh = ensureSheetWithHeaders_(ss, PORTAL_SERVICE_CONTACTS_SHEET, PORTAL_SERVICE_CONTACTS_HEADERS);
  var clean = sanitizeServiceContactsList_(contacts);
  var payload = JSON.stringify({ v: 1, contacts: clean });
  if (payload.length > 48000) return { ok: false, error: "service_contacts_payload_too_large" };
  var row = ["default", payload];
  if (sh.getLastRow() < 2) sh.appendRow(row);
  else sh.getRange(2, 1, 1, 2).setValues([row]);
  return { ok: true };
}

/** Mobile digits -> "deny" | "allow" (omit key for portal default: deny if no payments, allow if paid). */
function sanitizeOwnerAccessMap_(raw) {
  var out = {};
  if (!raw || typeof raw !== "object") return out;
  var keys = Object.keys(raw);
  var i;
  for (i = 0; i < keys.length && i < 5000; i++) {
    var k = keys[i];
    var d = String(k || "").replace(/\D/g, "");
    if (d.length < 10 || d.length > 15) continue;
    var v = String(raw[k] || "").toLowerCase();
    if (v === "deny") out[d] = "deny";
    else if (v === "allow") out[d] = "allow";
  }
  return out;
}

function readPortalOwnerAccess_(ss) {
  var sh = ss.getSheetByName(PORTAL_OWNER_ACCESS_SHEET);
  if (!sh || sh.getLastRow() < 2) return {};
  var cell = sh.getRange(2, 2).getValue();
  var s = String(cell || "").trim();
  if (!s) return {};
  try {
    var o = JSON.parse(s);
    var m = o && o.byMobile && typeof o.byMobile === "object" ? o.byMobile : {};
    return sanitizeOwnerAccessMap_(m);
  } catch (e) {
    return {};
  }
}

function writePortalOwnerAccess_(ss, map) {
  var sh = ensureSheetWithHeaders_(ss, PORTAL_OWNER_ACCESS_SHEET, PORTAL_OWNER_ACCESS_HEADERS);
  var clean = sanitizeOwnerAccessMap_(map);
  var payload = JSON.stringify({ v: 1, byMobile: clean });
  if (payload.length > 48000) return { ok: false, error: "owner_access_payload_too_large" };
  var row = ["default", payload];
  if (sh.getLastRow() < 2) sh.appendRow(row);
  else sh.getRange(2, 1, 1, 2).setValues([row]);
  return { ok: true };
}

function audit_(ss, actor, action, detailObj) {
  var sh = ensureSheetWithHeaders_(ss, PORTAL_AUDIT_SHEET, PORTAL_AUDIT_HEADERS);
  var detail = "";
  try { detail = JSON.stringify(detailObj || {}); } catch (e) { detail = String(detailObj || ""); }
  sh.appendRow([nowIso_(), String(actor || ""), String(action || ""), detail]);
}

function appendUserInbox_(ss, toMobileDigits, kind, title, body) {
  var mob = String(toMobileDigits || "").replace(/\D/g, "");
  if (!mob) mob = "*";
  var sh = ensureSheetWithHeaders_(ss, PORTAL_USER_INBOX_SHEET, PORTAL_USER_INBOX_HEADERS);
  sh.appendRow([newId_(), nowIso_(), mob, String(kind || ""), String(title || "").slice(0, 500), String(body || "").slice(0, 4000), ""]);
}

function readUserInbox_(ss, mobDigits) {
  var sh = ss.getSheetByName(PORTAL_USER_INBOX_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = rowsToObjects_(sh, PORTAL_USER_INBOX_HEADERS);
  var want = String(mobDigits || "").replace(/\D/g, "");
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var rawTm = String(r.toMobile || "").trim();
    var tm = rawTm.replace(/\D/g, "");
    if (rawTm !== "*" && tm !== want) continue;
    out.push({
      id: String(r.id || ""),
      atIso: String(r.atIso || ""),
      toMobile: String(r.toMobile || ""),
      kind: String(r.kind || ""),
      title: String(r.title || ""),
      body: String(r.body || ""),
      readAt: String(r.readAt || "")
    });
  }
  out.sort(function (a, b) {
    return String(b.atIso).localeCompare(String(a.atIso));
  });
  return out.slice(0, 100);
}

function markUserInboxRead_(ss, mobDigits, ids) {
  var want = String(mobDigits || "").replace(/\D/g, "");
  if (!want || !ids || !ids.length) return 0;
  var set = {};
  for (var i = 0; i < ids.length; i++) set[String(ids[i])] = true;
  var sh = ss.getSheetByName(PORTAL_USER_INBOX_SHEET);
  if (!sh || sh.getLastRow() < 2) return 0;
  var lr = sh.getLastRow();
  var vals = sh.getRange(2, 1, lr, PORTAL_USER_INBOX_HEADERS.length).getValues();
  var n = 0;
  for (var r = 0; r < vals.length; r++) {
    var row = vals[r];
    var id = String(row[0] || "");
    if (!set[id]) continue;
    if (String(row[6] || "").trim()) continue;
    var rawTm = String(row[2] || "").trim();
    var tm = rawTm.replace(/\D/g, "");
    if (rawTm !== "*" && tm !== want) continue;
    sh.getRange(r + 2, 7).setValue(nowIso_());
    n++;
  }
  if (n) invalidatePortalStateCache_();
  return n;
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
  // Header-based read: works when collection_data / collection_m_* columns were reordered in the Sheet UI.
  var master = ss.getSheetByName(TARGET_SHEET_NAME);
  var out = [];
  if (master) {
    ensureHeaders_(master);
    out = paymentsFromCollectionSheet_(master, ss);
  }
  var monthRows = paymentsFromBackupTabs_(ss);
  return mergePortalPaymentsDedupe_(out, monthRows);
}

function getPortalState_(ss) {
  // Small cache to speed up repeated dashboard refreshes.
  // Avoid long stale cache; keep very short.
  try {
    var cache = CacheService.getScriptCache();
    var cached = cache.get("portal_state_v1");
    if (cached) {
      try {
        var cachedOut = JSON.parse(cached);
        cachedOut.banking = readPortalBankingObject_(ss);
        cachedOut.projectDocs = readPortalProjectDocs_(ss);
        cachedOut.meetingDocs = readPortalMeetingDocs_(ss);
        cachedOut.societyDetails = readPortalSocietyDetails_(ss);
        cachedOut.serviceContacts = readPortalServiceContacts_(ss);
        cachedOut.ownerAccess = readPortalOwnerAccess_(ss);
        cachedOut.expenses = readPortalExpenses_(ss);
        cachedOut.ownerPortalMayYear = readPortalOwnerFyMayYear_(ss);
        cachedOut.gateVisits = readPortalGateVisits_(ss);
        return cachedOut;
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
  var payments = readPortalPayments_(ss);
  var out = {
    ok: true,
    payments: payments,
    pending: rowsToObjects_(pen, PORTAL_PENDING_HEADERS),
    tickets: rowsToObjects_(tix, PORTAL_TICKETS_HEADERS),
    notices: rowsToObjects_(noti, PORTAL_NOTICES_HEADERS)
  };
  // Normalize ym/plot fields so clients are consistent.
  try {
    for (var i = 0; i < out.payments.length; i++) {
      out.payments[i].ym = portalYmCanon_(ss, out.payments[i].ym);
      out.payments[i].plotNo = String(out.payments[i].plotNo || "").trim();
    }
    for (var j = 0; j < out.pending.length; j++) out.pending[j].ym = portalYmCanon_(ss, out.pending[j].ym);
  } catch (eN) {}

  // Merge collection_data-derived payments with portal_payments (same plot+month: pick best row).
  try {
    var colPay = paymentsFromCollectionData_(ss);
    out.payments = mergePortalPaymentsDedupe_(out.payments, colPay);
  } catch (eM) {}
  out.banking = readPortalBankingObject_(ss);
  out.projectDocs = readPortalProjectDocs_(ss);
  out.meetingDocs = readPortalMeetingDocs_(ss);
  out.societyDetails = readPortalSocietyDetails_(ss);
  out.serviceContacts = readPortalServiceContacts_(ss);
  out.ownerAccess = readPortalOwnerAccess_(ss);
  out.expenses = readPortalExpenses_(ss);
  out.ownerPortalMayYear = readPortalOwnerFyMayYear_(ss);
  out.gateVisits = readPortalGateVisits_(ss);
  try {
    // Cache payments/pending/tickets/notices/expenses (banking + project docs merged fresh from sheet on cache hit).
    var cachePayload = {
      ok: out.ok,
      payments: out.payments,
      pending: out.pending,
      tickets: out.tickets,
      notices: out.notices,
      expenses: out.expenses,
      ownerPortalMayYear: out.ownerPortalMayYear,
      gateVisits: out.gateVisits
    };
    // Longer TTL avoids a burst of concurrent /state recomputes returning subtly different payloads;
    // mutations still call invalidatePortalStateCache_().
    CacheService.getScriptCache().put("portal_state_v1", JSON.stringify(cachePayload), 120);
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
    ensureSheetWithHeaders_(ss, PORTAL_BANKING_SHEET, PORTAL_BANKING_HEADERS);
    ensureSheetWithHeaders_(ss, PORTAL_PROJECT_DOCS_SHEET, PORTAL_PROJECT_DOCS_HEADERS);
    ensureSheetWithHeaders_(ss, PORTAL_SERVICE_CONTACTS_SHEET, PORTAL_SERVICE_CONTACTS_HEADERS);
    ensureSheetWithHeaders_(ss, PORTAL_OWNER_ACCESS_SHEET, PORTAL_OWNER_ACCESS_HEADERS);
    ensureSheetWithHeaders_(ss, PORTAL_USER_INBOX_SHEET, PORTAL_USER_INBOX_HEADERS);
    ensureSheetWithHeaders_(ss, PORTAL_EXPENSES_SHEET, PORTAL_EXPENSES_HEADERS);
    ensureSheetWithHeaders_(ss, PORTAL_FY_SETTINGS_SHEET, PORTAL_FY_SETTINGS_HEADERS);
    ensureSheetWithHeaders_(ss, PORTAL_GATE_VISITS_SHEET, PORTAL_GATE_VISITS_HEADERS);
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

/** ym "2025-04" (or "2025-4") -> "collection_y_2025"; invalid ym -> null */
function yearBackupSheetName_(ym) {
  const s = String(ym || "").trim();
  const m = s.match(/^(\d{4})-\d{1,2}$/);
  if (!m) return null;
  return YEAR_TAB_PREFIX + m[1];
}

/** Legacy: ym -> "collection_m_202504" (read/delete only). */
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
  const plotNo = String(entry && entry.plotNo != null ? entry.plotNo : "").trim();
  const ym = portalYmCanon_(ss, entry && entry.ym != null ? entry.ym : "");
  if (!plotNo || !ym) return;
  const entryNorm = Object.assign({}, entry, {
    plotNo: plotNo,
    ym: ym,
    monthLabel: String(entry && entry.monthLabel != null ? entry.monthLabel : ym)
  });
  const row = buildRow_(entryNorm);
  // At most one row per plot+month per sheet. Master and year tabs are checked independently so a
  // row present only on collection_data still gets mirrored to collection_y_YYYY.
  if (!collectionAnyRowExists_(master, plotNo, ym)) {
    master.appendRow(row);
  }
  const yname = yearBackupSheetName_(ym);
  if (yname) {
    const ysh = ss.getSheetByName(yname) || ss.insertSheet(yname);
    ensureHeaders_(ysh);
    if (!collectionAnyRowExists_(ysh, plotNo, ym)) {
      ysh.appendRow(row);
    }
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

  // Delete from year backup tabs (one tab may hold many months)
  var yearTabs = {};
  for (var ymKey in setYm) {
    if (!Object.prototype.hasOwnProperty.call(setYm, ymKey)) continue;
    var yname = yearBackupSheetName_(ymKey);
    if (yname) yearTabs[yname] = true;
  }
  for (var yt in yearTabs) {
    if (!Object.prototype.hasOwnProperty.call(yearTabs, yt)) continue;
    var ysh = ss.getSheetByName(yt);
    if (!ysh) continue;
    removed += deleteWhere_(ysh, function(row){
      return String(row[1]).trim() === plot && !!setYm[ymCellToCanon_(ss, row[2])];
    });
  }

  // Legacy month backup tabs (if still present from older portal versions)
  for (var ym in setYm) {
    if (!Object.prototype.hasOwnProperty.call(setYm, ym)) continue;
    var mname = monthBackupSheetName_(ym);
    if (!mname) continue;
    var msh = ss.getSheetByName(mname);
    if (!msh) continue;
    var ymNorm = normalizeYm_(ym);
    removed += deleteWhere_(msh, function(row){
      return String(row[1]).trim() === plot && ymCellToCanon_(ss, row[2]) === ymNorm;
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
      var st0 = getPortalState_(ss);
      var mobQ = String(data.forUserMobile || "").replace(/\D/g, "");
      if (mobQ) {
        try {
          st0.inbox = readUserInbox_(ss, mobQ);
        } catch (eInbox) {
          st0.inbox = [];
        }
      }
      return json_(st0, 200);
    }
    if (action === "markUserInboxRead") {
      var mobM = String(data.forUserMobile || "").replace(/\D/g, "");
      var idsM = Array.isArray(data.ids) ? data.ids.map(function (x) { return String(x); }) : [];
      if (!mobM || !idsM.length) return json_({ ok: false, error: "forUserMobile and ids[] required" }, 400);
      var nM = markUserInboxRead_(ss, mobM, idsM);
      return json_({ ok: true, updated: nM }, 200);
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
        var py = ymCellToCanon_(ss, items[i].ym);
        if (String(items[i].plotNo || "").trim() === plotNo && py === ym) {
          return json_({ ok:false, error:"pending_exists" }, 409);
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
      var ymA = portalYmCanon_(ss, req.ym);
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
      var mobAp = String(req.requesterMobile || "").replace(/\D/g, "");
      if (mobAp) {
        appendUserInbox_(ss, mobAp, "payment_approved", "Payment approved",
          "Your maintenance payment for plot " + String(req.plotNo || "").trim() + ", month " + ymA + ", was approved. It is now recorded in the society collection.");
      }
      audit_(ss, actor, "approvePaymentRequest", { id:idA, paymentId:payId, plotNo:req.plotNo, ym:req.ym });
      invalidatePortalStateCache_();
      return json_({ ok:true, paymentId: payId }, 200);
    }
    if (action === "rejectPaymentRequest") {
      var idR = String(data.id || "").trim();
      var actorR = String(data.actor || "admin").trim();
      if (!idR) return json_({ ok:false, error:"id required" }, 400);
      var pendSh2 = ensureSheetWithHeaders_(ss, PORTAL_PENDING_SHEET, PORTAL_PENDING_HEADERS);
      var pendObjs = rowsToObjects_(pendSh2, PORTAL_PENDING_HEADERS);
      var reqR = null;
      for (var pri = 0; pri < pendObjs.length; pri++) if (String(pendObjs[pri].id) === idR) { reqR = pendObjs[pri]; break; }
      var removed = deleteWhere_(pendSh2, function(row){ return String(row[0]) === idR; });
      if (reqR) {
        var mobRj = String(reqR.requesterMobile || "").replace(/\D/g, "");
        var ymrj = portalYmCanon_(ss, reqR.ym);
        if (mobRj) {
          appendUserInbox_(ss, mobRj, "payment_rejected", "Payment request not approved",
            "Your payment request for plot " + String(reqR.plotNo || "").trim() + ", month " + ymrj + ", was rejected by an admin. You may submit a new request if needed.");
        }
      }
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
      appendUserInbox_(ss, "*", "notice_added", "New society notice", String(title) + " — see the Notices section on the owner portal.");
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
    if (action === "saveBanking") {
      var actorB = String(data.actor || "admin").trim();
      var bankingIn = data.banking;
      if (!bankingIn || typeof bankingIn !== "object") return json_({ ok:false, error:"banking object required" }, 400);
      var wr = writePortalBankingObject_(ss, bankingIn);
      if (!wr.ok) return json_(wr, 400);
      appendUserInbox_(ss, "*", "banking_updated", "Account & UPI details updated", "Society banking / UPI information was updated. Open Account & UPI Details to review.");
      audit_(ss, actorB, "saveBanking", { ok: true });
      invalidatePortalStateCache_();
      return json_({ ok:true }, 200);
    }
    if (action === "saveProjectDocs") {
      var actorDocs = String(data.actor || "portal").trim();
      var docsIn = Array.isArray(data.docs) ? data.docs : [];
      var wrDocs = writePortalProjectDocs_(ss, docsIn);
      if (!wrDocs.ok) return json_(wrDocs, 400);
      audit_(ss, actorDocs, "saveProjectDocs", { count: sanitizeProjectDocsList_(docsIn).length });
      invalidatePortalStateCache_();
      return json_({ ok: true, count: sanitizeProjectDocsList_(docsIn).length }, 200);
    }
    if (action === "saveMeetingDocs") {
      var actorMtg = String(data.actor || "portal").trim();
      var mtgIn = Array.isArray(data.docs) ? data.docs : [];
      var wrMtg = writePortalMeetingDocs_(ss, mtgIn);
      if (!wrMtg.ok) return json_(wrMtg, 400);
      audit_(ss, actorMtg, "saveMeetingDocs", { count: sanitizeProjectDocsList_(mtgIn).length });
      invalidatePortalStateCache_();
      return json_({ ok: true, count: sanitizeProjectDocsList_(mtgIn).length }, 200);
    }
    if (action === "saveSocietyDetails") {
      var actorSoc = String(data.actor || "admin").trim();
      var detailsIn = data.details;
      if (!detailsIn || typeof detailsIn !== "object") return json_({ ok: false, error: "details object required" }, 400);
      var wrSoc = writePortalSocietyDetails_(ss, detailsIn);
      if (!wrSoc.ok) return json_(wrSoc, 400);
      audit_(ss, actorSoc, "saveSocietyDetails", { ok: true });
      invalidatePortalStateCache_();
      return json_({ ok: true }, 200);
    }
    if (action === "saveServiceContacts") {
      var actorSc = String(data.actor || "portal").trim();
      var contactsIn = Array.isArray(data.contacts) ? data.contacts : [];
      var wrSc = writePortalServiceContacts_(ss, contactsIn);
      if (!wrSc.ok) return json_(wrSc, 400);
      audit_(ss, actorSc, "saveServiceContacts", { count: sanitizeServiceContactsList_(contactsIn).length });
      invalidatePortalStateCache_();
      return json_({ ok: true, count: sanitizeServiceContactsList_(contactsIn).length }, 200);
    }
    if (action === "saveOwnerAccess") {
      var actorOa = String(data.actor || "portal").trim();
      var mapIn = data.byMobile && typeof data.byMobile === "object" ? data.byMobile : {};
      var wrOa = writePortalOwnerAccess_(ss, mapIn);
      if (!wrOa.ok) return json_(wrOa, 400);
      var cntOa = Object.keys(sanitizeOwnerAccessMap_(mapIn)).length;
      audit_(ss, actorOa, "saveOwnerAccess", { denyCount: cntOa });
      invalidatePortalStateCache_();
      return json_({ ok: true, denyCount: cntOa }, 200);
    }
    if (action === "saveOwnerPortalFy") {
      var actorFy = String(data.actor || "admin").trim();
      var wrFy = writePortalOwnerFyMayYear_(ss, data.ownerMayYear);
      if (!wrFy.ok) return json_(wrFy, 400);
      audit_(ss, actorFy, "saveOwnerPortalFy", { ownerMayYear: Math.round(Number(data.ownerMayYear)) });
      invalidatePortalStateCache_();
      return json_({ ok: true }, 200);
    }
    if (action === "addGateVisit") {
      var actorG = String(data.actor || "").trim();
      if (actorG !== "watchman") return json_({ ok: false, error: "watchman actor required" }, 403);
      var plotG = String(data.plotNo || "").trim();
      var vName = String(data.visitorName || "").trim();
      var vMob = String(data.visitorMobile || "").trim().slice(0, 40);
      var veh = String(data.vehicle || "").trim().slice(0, 80);
      var purp = String(data.purpose || "").trim().slice(0, 500);
      if (!plotG || !vName) return json_({ ok: false, error: "plotNo and visitorName required" }, 400);
      var ownerDig = lookupPrimaryMobileDigitsForPlot_(ss, plotG);
      if (!ownerDig) return json_({ ok: false, error: "plot_not_found_or_no_primary_mobile" }, 400);
      var idG = newId_();
      var atG = nowIso_();
      var shG = ensureSheetWithHeaders_(ss, PORTAL_GATE_VISITS_SHEET, PORTAL_GATE_VISITS_HEADERS);
      shG.appendRow([idG, atG, plotG, ownerDig, vName, vMob, veh, purp, ""]);
      var titleIn = "Visitor at gate — Plot " + plotG;
      var bodyIn =
        "Visitor: " + vName +
        (vMob ? "\nVisitor mobile: " + vMob : "") +
        (veh ? "\nVehicle: " + veh : "") +
        (purp ? "\nPurpose / visiting: " + purp : "") +
        "\n\nSecurity may WhatsApp you with visitor details.";
      appendUserInbox_(ss, ownerDig, "gate_visitor", titleIn, bodyIn);
      audit_(ss, "watchman", "addGateVisit", { id: idG, plotNo: plotG, ownerMobile: ownerDig });
      invalidatePortalStateCache_();
      return json_({ ok: true, id: idG, ownerMobile: ownerDig, atIso: atG }, 200);
    }
    if (action === "updateGateVisit") {
      var actorUg = String(data.actor || "").trim();
      if (actorUg !== "watchman") return json_({ ok: false, error: "watchman actor required" }, 403);
      var idUg = String(data.id || "").trim();
      var plotUg = String(data.plotNo || "").trim();
      var vNameUg = String(data.visitorName || "").trim();
      var vMobUg = String(data.visitorMobile || "").trim().slice(0, 40);
      var vehUg = String(data.vehicle || "").trim().slice(0, 80);
      var purpUg = String(data.purpose || "").trim().slice(0, 500);
      if (!idUg || !plotUg || !vNameUg) return json_({ ok: false, error: "id, plotNo and visitorName required" }, 400);
      var ownerDigUg = lookupPrimaryMobileDigitsForPlot_(ss, plotUg);
      if (!ownerDigUg) return json_({ ok: false, error: "plot_not_found_or_no_primary_mobile" }, 400);
      var shUg = ensureSheetWithHeaders_(ss, PORTAL_GATE_VISITS_SHEET, PORTAL_GATE_VISITS_HEADERS);
      var rowUg = findPortalGateVisitRowNum_(ss, idUg);
      if (rowUg < 2) return json_({ ok: false, error: "not_found" }, 404);
      var atKeep = String(shUg.getRange(rowUg, 2).getDisplayValue() || "").trim();
      var photoKeep = String(shUg.getRange(rowUg, 9).getDisplayValue() || "").trim();
      shUg.getRange(rowUg, 1, 1, 9).setValues([[idUg, atKeep, plotUg, ownerDigUg, vNameUg, vMobUg, vehUg, purpUg, photoKeep]]);
      audit_(ss, "watchman", "updateGateVisit", { id: idUg, plotNo: plotUg });
      invalidatePortalStateCache_();
      return json_({ ok: true, id: idUg, ownerMobile: ownerDigUg, atIso: atKeep }, 200);
    }
    if (action === "deleteGateVisit") {
      var actorDg = String(data.actor || "").trim();
      if (actorDg !== "watchman") return json_({ ok: false, error: "watchman actor required" }, 403);
      var idDg = String(data.id || "").trim();
      if (!idDg) return json_({ ok: false, error: "id required" }, 400);
      var shDg = ss.getSheetByName(PORTAL_GATE_VISITS_SHEET);
      if (!shDg || shDg.getLastRow() < 2) return json_({ ok: false, error: "not_found" }, 404);
      var rowDg = findPortalGateVisitRowNum_(ss, idDg);
      if (rowDg < 2) return json_({ ok: false, error: "not_found" }, 404);
      shDg.deleteRow(rowDg);
      audit_(ss, "watchman", "deleteGateVisit", { id: idDg });
      invalidatePortalStateCache_();
      return json_({ ok: true }, 200);
    }
    if (action === "addExpense") {
      var actorE = String(data.actor || "admin").trim();
      var ymE = normalizeYm_(data.ym);
      var amountE = Number(data.amount || 0);
      var catE = String(data.category || "").trim();
      var descE = String(data.description || "").trim();
      var paidE = String(data.paidTo || "").trim();
      if (!ymE || amountE <= 0) return json_({ ok: false, error: "ym and positive amount required" }, 400);
      var shE = ensureSheetWithHeaders_(ss, PORTAL_EXPENSES_SHEET, PORTAL_EXPENSES_HEADERS);
      var idE = newId_();
      shE.appendRow([idE, nowIso_(), ymE, catE, amountE, descE, paidE]);
      audit_(ss, actorE, "addExpense", { id: idE, ym: ymE, amount: amountE, category: catE });
      invalidatePortalStateCache_();
      return json_({ ok: true, id: idE }, 200);
    }
    if (action === "updateExpense") {
      var actorU = String(data.actor || "admin").trim();
      var idU = String(data.id || "").trim();
      var ymU = normalizeYm_(data.ym);
      var amountU = Number(data.amount || 0);
      var catU = String(data.category || "").trim();
      var descU = String(data.description || "").trim();
      var paidU = String(data.paidTo || "").trim();
      if (!idU || !ymU || amountU <= 0) return json_({ ok: false, error: "id, ym and positive amount required" }, 400);
      var shU = ensureSheetWithHeaders_(ss, PORTAL_EXPENSES_SHEET, PORTAL_EXPENSES_HEADERS);
      var lastRowU = shU.getLastRow();
      if (lastRowU < 2) return json_({ ok: false, error: "no_expenses" }, 404);
      var valsU = shU.getRange(2, 1, lastRowU, 1).getValues();
      var targetU = -1;
      for (var ui = 0; ui < valsU.length; ui++) {
        if (String(valsU[ui][0]) === idU) { targetU = ui + 2; break; }
      }
      if (targetU < 0) return json_({ ok: false, error: "not_found" }, 404);
      shU.getRange(targetU, 2).setValue(nowIso_());
      shU.getRange(targetU, 3, 1, 7).setValues([[ymU, catU, amountU, descU, paidU]]);
      audit_(ss, actorU, "updateExpense", { id: idU, ym: ymU, amount: amountU });
      invalidatePortalStateCache_();
      return json_({ ok: true }, 200);
    }
    if (action === "deleteExpense") {
      var actorDel = String(data.actor || "admin").trim();
      var idDel = String(data.id || "").trim();
      if (!idDel) return json_({ ok: false, error: "id required" }, 400);
      var shDel = ensureSheetWithHeaders_(ss, PORTAL_EXPENSES_SHEET, PORTAL_EXPENSES_HEADERS);
      var lastRowDel = shDel.getLastRow();
      if (lastRowDel < 2) return json_({ ok: false, error: "no_expenses" }, 404);
      var valsDel = shDel.getRange(2, 1, lastRowDel, 1).getValues();
      var targetDel = -1;
      for (var di = 0; di < valsDel.length; di++) {
        if (String(valsDel[di][0]) === idDel) {
          targetDel = di + 2;
          break;
        }
      }
      if (targetDel < 0) return json_({ ok: false, error: "not_found" }, 404);
      shDel.deleteRow(targetDel);
      audit_(ss, actorDel, "deleteExpense", { id: idDel });
      invalidatePortalStateCache_();
      return json_({ ok: true }, 200);
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

/**
 * Run once in Apps Script editor: copy rows from legacy collection_m_YYYYMM tabs
 * into collection_y_YYYY (skips duplicates). Old month tabs are left in place — delete manually after verifying.
 */
function migrateCollectionMonthTabsToYearTabs() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheets = ss.getSheets();
  var moved = 0;
  var si;
  for (si = 0; si < sheets.length; si++) {
    var sh = sheets[si];
    var name = String(sh.getName() || "");
    if (name.indexOf(MONTH_TAB_PREFIX) !== 0) continue;
    var ymPart = name.slice(MONTH_TAB_PREFIX.length);
    if (!/^\d{6}$/.test(ymPart)) continue;
    var ym = ymPart.slice(0, 4) + "-" + ymPart.slice(4, 6);
    var yname = yearBackupSheetName_(ym);
    if (!yname) continue;
    var ysh = ss.getSheetByName(yname) || ss.insertSheet(yname);
    ensureHeaders_(ysh);
    ensureHeaders_(sh);
    var lastRow = sh.getLastRow();
    if (lastRow < 2) continue;
    var vals = sh.getRange(2, 1, lastRow, COLLECTION_HEADERS.length).getValues();
    var ri;
    for (ri = 0; ri < vals.length; ri++) {
      var row = vals[ri];
      var plotNo = String(row[1] || "").trim();
      var rowYm = portalYmCanon_(ss, row[2]);
      if (!plotNo || !rowYm) continue;
      if (!collectionAnyRowExists_(ysh, plotNo, rowYm)) {
        ysh.appendRow(row);
        moved++;
      }
    }
  }
  Logger.log("Migrated " + moved + " row(s) from collection_m_* to collection_y_* tabs.");
}
