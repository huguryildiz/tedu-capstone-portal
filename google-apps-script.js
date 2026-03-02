// google-apps-script.js
// ============================================================
// EE 492 Senior Design — Jury Evaluation App
// Google Apps Script backend (single file, deploy as Web App)
// ============================================================
//
// ── Sheets layout ────────────────────────────────────────────
//
// "Evaluations" (15 columns A–O):
//   A  Juror Name
//   B  Department / Institution
//   C  Juror ID          ← deterministic 8-hex hash of norm(name)__norm(dept)
//   D  Timestamp         ← "dd.MM.yyyy HH:mm:ss" (Europe/Istanbul)
//   E  Group No
//   F  Group Name
//   G  Technical (30)
//   H  Written (30)
//   I  Oral (30)
//   J  Teamwork (10)
//   K  Total (100)
//   L  Comments
//   M  Status            ← "in_progress" | "group_submitted" | "all_submitted"
//   N  EditingFlag       ← "editing" | ""
//   O  Secret            ← per-juror token secret (from PropertiesService)
//
// "Drafts" (3 columns A–C):
//   A  DraftKey (jurorId)
//   B  DraftJSON
//   C  UpdatedAt
//
// "Info" (4 columns A–D):
//   A  Group No   B  Group Name   C  Group Desc   D  Students
//
// ── PropertiesService keys ───────────────────────────────────
//   ADMIN_PASSWORD          → plaintext admin password
//   API_SECRET              → shared secret checked on public PIN endpoints
//   PIN__{jurorId}          → 4-digit PIN string
//   LOCKED__{jurorId}       → "1" when account is brute-force locked
//   ATTEMPTS__{jurorId}     → failed attempt count (string integer)
//   RESET_UNLOCK__{jurorId} → ms timestamp of last resetJuror call
//   SECRET__{jurorId}       → per-juror token secret (16-byte hex)
//   META__{jurorId}         → "juryName||juryDept"
//
// ── Token format ─────────────────────────────────────────────
//   token = base64( jurorId + "__" + perJurorSecret )
//
// ── GET endpoints ────────────────────────────────────────────
//   admin (password-gated):
//     ?action=export&pass=X
//     ?action=initInfo&pass=X
//     ?action=resetPin&jurorId=X&pass=X
//   public (apiSecret-gated):
//     ?action=checkPin&jurorId=X&secret=X
//     ?action=createPin&jurorId=X&juryName=X&juryDept=X&secret=X
//     ?action=verifyPin&jurorId=X&pin=X&secret=X
//   token-gated:
//     ?action=loadDraft&token=X
//     ?action=verify&token=X
//     ?action=myscores&token=X
//
// ── POST body shapes ─────────────────────────────────────────
//   { action:"saveDraft",       token, draft }
//   { action:"deleteDraft",     token }
//   { action:"deleteJurorData", token }
//   { action:"resetJuror",      token }
//   { rows:[...], token }            ← upsert evaluation rows
// ============================================================

var EVAL_SHEET  = "Evaluations";
var DRAFT_SHEET = "Drafts";
var INFO_SHEET  = "Info";
var NUM_COLS    = 15;          // A–O
var TZ          = "Europe/Istanbul";
var TS_FORMAT = "dd.MM.yyyy HH:mm:ss";

var RESET_UNLOCK_MINUTES = 20;
var MAX_PIN_ATTEMPTS     = 3;

// ── Group definitions ─────────────────────────────────────────
var PROJECTS_DATA = [
  { id: 1, name: "Group 1", desc: "Göksiper Hava Savunma Sistemi",
    students: ["Mustafa Yusuf Ünal", "Ayça Naz Dedeoğlu", "Onur Mesci", "Çağan Erdoğan"] },
  { id: 2, name: "Group 2", desc: "Radome and Radar-Absorbing Material Electromagnetic Design Software (REMDET)",
    students: ["Niyazi Atilla Özer", "Bertan Ünver", "Ada Tatlı", "Nesibe Aydın"] },
  { id: 3, name: "Group 3", desc: "Smart Crosswalk",
    students: ["Sami Eren Germeç"] },
  { id: 4, name: "Group 4", desc: "Radar Cross Section (RCS) Analysis — Supporting Multi-Purpose Ray Tracing Algorithm",
    students: ["Ahmet Melih Yavuz", "Yasemin Erciyas"] },
  { id: 5, name: "Group 5", desc: "Monitoring Pilots' Health Status and Cognitive Abilities During Flight",
    students: ["Aysel Mine Çaylan", "Selimhan Kaynar", "Abdulkadir Sazlı", "Alp Efe İpek"] },
  { id: 6, name: "Group 6", desc: "AKKE — Smart Command and Control Glove",
    students: ["Şevval Kurtulmuş", "Abdullah Esin", "Berk Çakmak", "Ömer Efe Dikici"] },
];

// ════════════════════════════════════════════════════════════
// Generic helpers
// ════════════════════════════════════════════════════════════

function respond(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

// Format an ISO timestamp string (or Date) into a human-readable local string.
// Returns "dd.MM.yyyy HH:mm:ss" in the Europe/Istanbul timezone.
function formatTs(raw) {
  try {
    if (typeof raw === "string") {
      var s = String(raw).trim();
      // If already in dd.MM.yyyy HH:mm[:ss], return as-is to avoid locale parsing swaps.
      if (/^\d{2}\.\d{2}\.\d{4} \d{2}:\d{2}(:\d{2})?$/.test(s)) return s;
    }
    var d = (raw instanceof Date) ? raw : new Date(raw);
    return Utilities.formatDate(d, TZ, TS_FORMAT);
  } catch (_) {
    return String(raw || "");
  }
}

// Parse a "dd.MM.yyyy HH:mm:ss" formatted timestamp back to milliseconds.
// Used for stale-update comparisons where the stored timestamp is in
// display format while the incoming timestamp is an ISO string.
// Returns 0 if the input cannot be parsed.
function parseFormattedTs(s) {
  var m = /^(\d{2})\.(\d{2})\.(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(String(s || "").trim());
  if (!m) return 0;
  return new Date(
    Number(m[3]), Number(m[2]) - 1, Number(m[1]),
    Number(m[4]), Number(m[5]), Number(m[6])
  ).getTime();
}

// Clamp a score value while preserving blanks.
// Returns "" if the input is empty/null/undefined, otherwise a number.
function clampScore(val, max) {
  if (val === "" || val === null || val === undefined) return "";
  var n = Number(val);
  if (!Number.isFinite(n)) n = 0;
  return Math.min(Math.max(n, 0), max);
}

// ── Auth helpers ──────────────────────────────────────────────

function checkApiSecret(secret) {
  var stored = PropertiesService.getScriptProperties().getProperty("API_SECRET") || "";
  return stored.length > 0 && secret === stored;
}

function isAuthorized(pass) {
  var stored = PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD") || "";
  return stored.length > 0 && pass === stored;
}

// ── Token helpers ─────────────────────────────────────────────

function secretPropKey(jurorId)    { return "SECRET__" + jurorId; }
function getPerJurorSecret(id)     { return PropertiesService.getScriptProperties().getProperty(secretPropKey(id)); }
function setPerJurorSecret(id, s)  { PropertiesService.getScriptProperties().setProperty(secretPropKey(id), s); }

function generateSecret() {
  var b = "";
  for (var i = 0; i < 16; i++) b += ("0" + Math.floor(Math.random() * 256).toString(16)).slice(-2);
  return b;
}

// token = base64( jurorId + "__" + perJurorSecret )
function buildToken(jurorId, secret) {
  return Utilities.base64Encode(jurorId + "__" + secret);
}

// Verify a token; returns { jurorId } or null.
function verifyToken(token) {
  if (!token) return null;
  try {
    var payload = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString();
    var sep     = payload.indexOf("__");
    if (sep < 0) return null;
    var jurorId = payload.slice(0, sep);
    var secret  = payload.slice(sep + 2);
    var stored  = getPerJurorSecret(jurorId);
    if (!stored || stored !== secret) return null;
    return { jurorId: jurorId };
  } catch (_) {
    return null;
  }
}

// ── Reset-unlock helpers ──────────────────────────────────────
// After resetJuror, a 20-minute window allows status to be
// downgraded from all_submitted during upsert.

function markResetUnlock(jurorId) {
  PropertiesService.getScriptProperties()
    .setProperty("RESET_UNLOCK__" + jurorId, String(Date.now()));
}

function isResetUnlockActive(jurorId) {
  var v = PropertiesService.getScriptProperties()
    .getProperty("RESET_UNLOCK__" + jurorId);
  if (!v) return false;
  var ts = parseInt(v, 10);
  return Number.isFinite(ts) && (Date.now() - ts) <= RESET_UNLOCK_MINUTES * 60 * 1000;
}

// ── PIN helpers ───────────────────────────────────────────────

function pinKey(id)      { return "PIN__"      + id; }
function lockedKey(id)   { return "LOCKED__"   + id; }
function attemptsKey(id) { return "ATTEMPTS__" + id; }

function getPin(id)      { return PropertiesService.getScriptProperties().getProperty(pinKey(id)); }
function setPin(id, pin) { PropertiesService.getScriptProperties().setProperty(pinKey(id), pin); }
function isLocked(id)    { return PropertiesService.getScriptProperties().getProperty(lockedKey(id)) === "1"; }
function lockAccount(id) { PropertiesService.getScriptProperties().setProperty(lockedKey(id), "1"); }

function getAttempts(id) {
  return parseInt(PropertiesService.getScriptProperties().getProperty(attemptsKey(id)) || "0", 10);
}
function setAttempts(id, count) {
  PropertiesService.getScriptProperties().setProperty(attemptsKey(id), String(count));
}
function clearLock(id) {
  var p = PropertiesService.getScriptProperties();
  p.deleteProperty(lockedKey(id));
  p.deleteProperty(attemptsKey(id));
}

function generatePin() {
  var p = "";
  for (var i = 0; i < 4; i++) p += String(Math.floor(Math.random() * 10));
  return p;
}

// ── Juror meta (name + dept stored at createPin time) ─────────
// Avoids the need to send juryName/juryDept on every token-gated call.

function jurorMetaKey(id) { return "META__" + id; }

function setJurorMeta(id, name, dept) {
  PropertiesService.getScriptProperties()
    .setProperty(jurorMetaKey(id), name + "||" + dept);
}

function getJurorMeta(id) {
  var v = PropertiesService.getScriptProperties().getProperty(jurorMetaKey(id));
  if (!v) return null;
  var parts = v.split("||");
  return { juryName: parts[0] || "", juryDept: parts[1] || "" };
}

// ── Upsert index — deduplication ─────────────────────────────
//
// Builds a map from composite key → row number.
// If the same key appears in multiple rows (race-condition
// duplicates from rapid instantWrite calls), ALL duplicate rows
// except the best one are deleted before the new upsert proceeds.
//
// "Best" row: highest-priority status, then latest timestamp.
// Priority: all_submitted(3) > group_submitted(2) > in_progress(1)
//
// Returns a fresh index map after deduplication.
function buildIndexAndDedupe(sheet, jurorId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return {};

  var values = sheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues();

  // Group rows by composite key for this juror.
  var byKey = {};
  var pri   = { all_submitted: 3, group_submitted: 2, in_progress: 1 };

  values.forEach(function(r, i) {
    var rJurorId = String(r[2] || "").trim();
    // Include all rows in the index, but only deduplicate for this juror.
    var groupNo  = String(r[4] || "").trim();
    var key      = rJurorId + "__" + groupNo;
    if (!key || key === "__") return;

    if (!byKey[key]) { byKey[key] = []; }
    byKey[key].push({ rowNum: i + 2, r: r });
  });

  // For each key that has >1 row belonging to this juror, keep only the best.
  var rowsToDelete = [];

  Object.keys(byKey).forEach(function(key) {
    var group = byKey[key].filter(function(entry) {
      return String(entry.r[2] || "").trim() === jurorId;
    });
    if (group.length <= 1) return;

    // Sort: highest priority first, then latest timestamp first.
    group.sort(function(a, b) {
      var pa = pri[String(a.r[12] || "").trim()] || 0;
      var pb = pri[String(b.r[12] || "").trim()] || 0;
      if (pb !== pa) return pb - pa;
      return String(b.r[3]) > String(a.r[3]) ? 1 : -1;
    });

    // Mark all but the first (best) for deletion.
    for (var i = 1; i < group.length; i++) {
      rowsToDelete.push(group[i].rowNum);
    }
  });

  // Delete duplicates from bottom up so row numbers stay valid.
  rowsToDelete.sort(function(a, b) { return b - a; });
  rowsToDelete.forEach(function(rn) { sheet.deleteRow(rn); });

  // Rebuild a clean index from the current sheet state.
  var newLastRow = sheet.getLastRow();
  if (newLastRow < 2) return {};

  var freshValues = sheet.getRange(2, 1, newLastRow - 1, NUM_COLS).getValues();
  var index = {};
  freshValues.forEach(function(r, i) {
    var rId  = String(r[2] || "").trim();
    var grp  = String(r[4] || "").trim();
    var k    = rId + "__" + grp;
    if (k !== "__") index[k] = i + 2;
  });
  return index;
}

// Ensure text-only columns (Juror ID col C, Timestamp col D) are never
// auto-converted by Sheets.  Run once per sheet lifetime; flag stored
// in script properties so subsequent calls are no-ops.
function ensureJurorIdTextFormat(sheet) {
  try {
    var props = PropertiesService.getScriptProperties();
    if (props.getProperty("JUROR_ID_TEXT_FORMAT") === "2") return;
    var maxRows = sheet.getMaxRows();
    sheet.getRange(1, 3, maxRows, 1).setNumberFormat("@"); // col C — Juror ID
    sheet.getRange(1, 4, maxRows, 1).setNumberFormat("@"); // col D — Timestamp
    props.setProperty("JUROR_ID_TEXT_FORMAT", "2"); // bump version to re-run on existing sheets
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════
// GET handler
// ════════════════════════════════════════════════════════════

function doGet(e) {
  try {
    var action  = norm(e.parameter.action || "");
    var token   = (e.parameter.token   || "").trim();
    var jurorId = (e.parameter.jurorId || "").trim();
    var apiSec  = (e.parameter.secret  || "").trim();

    // ── Admin endpoints (password-only) ───────────────────────

    if (action === "export") {
      if (!isAuthorized(e.parameter.pass || "")) return respond({ status: "unauthorized" });
      var ss    = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(EVAL_SHEET);
      if (!sheet) return respond({ status: "ok", rows: [] });
      var values  = sheet.getDataRange().getValues();
      var headers = values.shift();
      var rows = values.map(function(r) {
        var obj = {};
        headers.forEach(function(h, i) { obj[String(h)] = r[i]; });
        return obj;
      });
      return respond({ status: "ok", rows: rows });
    }

    if (action === "initinfo") {
      if (!isAuthorized(e.parameter.pass || "")) return respond({ status: "unauthorized" });
      var ss        = SpreadsheetApp.getActiveSpreadsheet();
      var infoSheet = ss.getSheetByName(INFO_SHEET) || ss.insertSheet(INFO_SHEET);
      infoSheet.clear();
      infoSheet.appendRow(["Group No", "Group Name", "Group Desc", "Students"]);
      infoSheet.getRange(1, 1, 1, 4).setFontWeight("bold").setBackground("#1d4ed8").setFontColor("white");
      infoSheet.setFrozenRows(1);
      PROJECTS_DATA.forEach(function(p) {
        infoSheet.appendRow([p.id, p.name, p.desc, (p.students || []).join(", ")]);
      });
      infoSheet.autoResizeColumns(1, 4);
      return respond({ status: "ok", message: "Info sheet refreshed with " + PROJECTS_DATA.length + " groups." });
    }

    if (action === "resetpin") {
      if (!isAuthorized(e.parameter.pass || "")) return respond({ status: "unauthorized" });
      if (!jurorId) return respond({ status: "error", message: "jurorId required" });
      var p = PropertiesService.getScriptProperties();
      p.deleteProperty(pinKey(jurorId));
      p.deleteProperty(secretPropKey(jurorId));
      clearLock(jurorId);
      return respond({ status: "ok", message: "PIN cleared for " + jurorId });
    }

    if (action === "allowedit") {
      if (!isAuthorized(e.parameter.pass || "")) return respond({ status: "unauthorized" });
      if (!jurorId) return respond({ status: "error", message: "jurorId required" });
      PropertiesService.getScriptProperties()
        .setProperty("EDIT_ALLOWED__" + jurorId, "true");
      return respond({ status: "ok" });
    }

    // ── Public PIN endpoints (apiSecret-gated) ────────────────

    if (action === "checkpin") {
      if (!checkApiSecret(apiSec)) return respond({ status: "unauthorized" });
      if (!jurorId) return respond({ status: "error", message: "jurorId required" });
      var attempts = getAttempts(jurorId);
      var left = Math.max(0, MAX_PIN_ATTEMPTS - attempts);
      if (isLocked(jurorId)) {
        return respond({ status: "ok", exists: false, locked: true, attemptsLeft: 0 });
      }
      return respond({
        status: "ok",
        exists: getPin(jurorId) !== null,
        locked: false,
        attemptsLeft: left,
      });
    }

    if (action === "createpin") {
      if (!checkApiSecret(apiSec)) return respond({ status: "unauthorized" });
      if (!jurorId) return respond({ status: "error", message: "jurorId required" });
      var juryName = (e.parameter.juryName || "").trim();
      var juryDept = (e.parameter.juryDept || "").trim();

      var existingPin = getPin(jurorId);
      var pin, perSecret;
      if (existingPin) {
        // PIN already exists — re-issue with a FRESH secret to invalidate old sessions.
        pin       = existingPin;
        perSecret = generateSecret();
        setPerJurorSecret(jurorId, perSecret);
      } else {
        pin       = generatePin();
        perSecret = generateSecret();
        setPin(jurorId, pin);
        setPerJurorSecret(jurorId, perSecret);
      }
      if (juryName) setJurorMeta(jurorId, juryName, juryDept);
      return respond({ status: "ok", pin: pin, token: buildToken(jurorId, perSecret) });
    }

    if (action === "verifypin") {
      if (!checkApiSecret(apiSec)) return respond({ status: "unauthorized" });
      if (!jurorId) return respond({ status: "error", message: "jurorId required" });
      var entered = String(e.parameter.pin || "").trim();

      if (isLocked(jurorId)) {
        return respond({ status: "locked", valid: false, locked: true, attemptsLeft: 0 });
      }

      var stored = getPin(jurorId);
      if (!stored) {
        // No PIN yet — issue a token anyway (graceful degradation).
        // Always rotate secret so any prior session is invalidated.
        var sec = generateSecret();
        setPerJurorSecret(jurorId, sec);
        return respond({ status: "ok", valid: true, locked: false,
          attemptsLeft: MAX_PIN_ATTEMPTS, token: buildToken(jurorId, sec) });
      }

      if (entered === stored) {
        setAttempts(jurorId, 0);
        // Always rotate secret — invalidates all previously issued tokens.
        var sec2 = generateSecret();
        setPerJurorSecret(jurorId, sec2);
        return respond({ status: "ok", valid: true, locked: false,
          attemptsLeft: MAX_PIN_ATTEMPTS, token: buildToken(jurorId, sec2) });
      }

      var attempts = getAttempts(jurorId) + 1;
      setAttempts(jurorId, attempts);
      var left = Math.max(0, MAX_PIN_ATTEMPTS - attempts);
      if (left === 0) lockAccount(jurorId);
      return respond({ status: "ok", valid: false, locked: left === 0, attemptsLeft: left });
    }

    if (action === "summary") {
      if (!checkApiSecret(apiSec)) return respond({ status: "unauthorized" });
      var ss    = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(EVAL_SHEET);
      if (!sheet) return respond({ status: "ok", totalJurors: 0, completedJurors: 0, lastUpdated: "" });
      var values = sheet.getDataRange().getValues();
      if (!values || values.length < 2) {
        return respond({ status: "ok", totalJurors: 0, completedJurors: 0, lastUpdated: "" });
      }
      var headers = values.shift();
      var idx = {};
      headers.forEach(function(h, i) { idx[String(h || "").trim()] = i; });
      var jurorIdx  = (idx["Juror ID"] != null) ? idx["Juror ID"] : 2;
      var tsIdx     = (idx["Timestamp"] != null) ? idx["Timestamp"] : 3;
      var statusIdx = (idx["Status"] != null) ? idx["Status"] : 12;
      var groupIdx  = (idx["Group No"] != null) ? idx["Group No"] : 4;

      var jurorMap = {};
      var finalByJuror = {};
      var lastMs = 0;

      values.forEach(function(r) {
        var jid = String(r[jurorIdx] || "").trim();
        if (!jid) return;
        jurorMap[jid] = true;

        var ts = String(r[tsIdx] || "");
        var ms = parseFormattedTs(ts) || new Date(ts).getTime() || 0;
        if (ms > lastMs) lastMs = ms;

        var status = String(r[statusIdx] || "");
        if (status !== "all_submitted") return;
        var group = String(r[groupIdx] || "").trim();
        if (!finalByJuror[jid]) finalByJuror[jid] = {};
        finalByJuror[jid][group] = true;
      });

      var totalJurors = Object.keys(jurorMap).length;
      var completedJurors = 0;
      Object.keys(jurorMap).forEach(function(jid) {
        var groups = finalByJuror[jid];
        if (groups && Object.keys(groups).length >= PROJECTS_DATA.length) {
          completedJurors++;
        }
      });

      return respond({
        status: "ok",
        totalJurors: totalJurors,
        completedJurors: completedJurors,
        lastUpdated: lastMs ? new Date(lastMs).toISOString() : "",
      });
    }

    // ── Token-gated GET endpoints ─────────────────────────────

    var identity = verifyToken(token);
    if (!identity) return respond({ status: "unauthorized", message: "Invalid or missing token." });
    var jid = identity.jurorId;

    // Lightweight heartbeat — token already validated above.
    if (action === "ping") {
      return respond({ status: "ok" });
    }

    if (action === "loaddraft") {
      var draftSheet = getOrCreateDraftSheet();
      var row        = findDraftRow(draftSheet, jid);
      if (!row) return respond({ status: "not_found" });
      try {
        return respond({ status: "ok", draft: JSON.parse(row[1]) });
      } catch (_) {
        return respond({ status: "error", message: "Corrupt draft JSON." });
      }
    }

    if (action === "verify") {
      // Returns the count of all_submitted rows for this juror.
      var ss    = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(EVAL_SHEET);
      if (!sheet) return respond({ status: "ok", submittedCount: 0 });
      var values = sheet.getDataRange().getValues();
      values.shift();
      var count = values.filter(function(r) {
        return String(r[2]).trim() === jid
            && String(r[12] || "").trim() === "all_submitted";
      }).length;
      return respond({ status: "ok", submittedCount: count });
    }

    if (action === "myscores") {
      // Returns the best row per group for this juror (all statuses included).
      // "Best" = highest priority status, then latest timestamp.
      // This is the source of truth for restoring scores on a new device.
      var ss    = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(EVAL_SHEET);
      if (!sheet) return respond({ status: "ok", rows: [] });
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return respond({ status: "ok", rows: [] });

      var values      = sheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues();
      var pri         = { all_submitted: 3, group_submitted: 2, in_progress: 1 };
      var bestByGroup = {};

      values.forEach(function(r) {
        if (String(r[2]).trim() !== jid) return;
        var groupNo = String(r[4] || "").trim();
        if (!groupNo) return;
        var prev = bestByGroup[groupNo];
        if (!prev) { bestByGroup[groupNo] = r; return; }
        var ns = String(r[12]    || "").trim();
        var ps = String(prev[12] || "").trim();
        if ((pri[ns] || 0) > (pri[ps] || 0)) { bestByGroup[groupNo] = r; return; }
        if ((pri[ns] || 0) === (pri[ps] || 0) && String(r[3]) > String(prev[3])) {
          bestByGroup[groupNo] = r;
        }
      });

      var out = Object.keys(bestByGroup).map(function(g) {
        var r = bestByGroup[g];
        return {
          juryName:    r[0],  juryDept:    r[1],  jurorId:     r[2],
          timestamp:   r[3],  projectId:   Number(r[4]), projectName: r[5],
          technical:   r[6],  design:      r[7],  delivery:    r[8],
          teamwork:    r[9],  total:       r[10], comments:    r[11],
          status:      r[12], editingFlag: r[13] || "",
        };
      }).sort(function(a, b) { return (a.projectId || 0) - (b.projectId || 0); });

      var editAllowed = PropertiesService.getScriptProperties()
        .getProperty("EDIT_ALLOWED__" + jid) === "true";
      return respond({ status: "ok", rows: out, editAllowed: editAllowed });
    }

    return respond({ status: "ok" });

  } catch (err) {
    return respond({ status: "error", message: String(err) });
  }
}

// ════════════════════════════════════════════════════════════
// POST handler
// ════════════════════════════════════════════════════════════

function doPost(e) {
  try {
    var data     = JSON.parse(e.postData.contents);
    var identity = verifyToken(data.token || "");
    if (!identity) return respond({ status: "unauthorized", message: "Invalid or missing token." });
    var jid = identity.jurorId;

    // ── Draft actions ─────────────────────────────────────────

    if (data.action === "saveDraft") {
      var draftSheet = getOrCreateDraftSheet();
      var json       = JSON.stringify(data.draft || {});
      var now        = new Date().toISOString();
      var rowIdx     = findDraftRowIndex(draftSheet, jid);
      if (rowIdx > 0) {
        draftSheet.getRange(rowIdx, 2, 1, 2).setValues([[json, now]]);
      } else {
        draftSheet.appendRow([jid, json, now]);
      }
      return respond({ status: "ok" });
    }

    if (data.action === "deleteDraft") {
      var draftSheet = getOrCreateDraftSheet();
      var rowIdx     = findDraftRowIndex(draftSheet, jid);
      if (rowIdx > 0) draftSheet.deleteRow(rowIdx);
      return respond({ status: "ok" });
    }

    if (data.action === "deleteJurorData") {
      var draftSheet = getOrCreateDraftSheet();
      var draftIdx   = findDraftRowIndex(draftSheet, jid);
      if (draftIdx > 0) draftSheet.deleteRow(draftIdx);

      var ss        = SpreadsheetApp.getActiveSpreadsheet();
      var evalSheet = ss.getSheetByName(EVAL_SHEET);
      var deleted   = 0;
      if (evalSheet) {
        var lastRow = evalSheet.getLastRow();
        if (lastRow >= 2) {
          var values = evalSheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues();
          for (var i = values.length - 1; i >= 0; i--) {
            if (String(values[i][2]).trim() === jid) {
              evalSheet.deleteRow(i + 2);
              deleted++;
            }
          }
        }
      }
      return respond({ status: "ok", deleted: deleted });
    }

    if (data.action === "resetJuror") {
      // Mark the unlock window so the next upsert can downgrade status.
      markResetUnlock(jid);
      // Consume the edit permission (single-use).
      PropertiesService.getScriptProperties().deleteProperty("EDIT_ALLOWED__" + jid);
      var ss    = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName(EVAL_SHEET);
      if (!sheet) return respond({ status: "ok", reset: 0 });
      var lastRow = sheet.getLastRow();
      if (lastRow < 2) return respond({ status: "ok", reset: 0 });
      var values = sheet.getRange(2, 1, lastRow - 1, NUM_COLS).getValues();
      var reset  = 0;
      values.forEach(function(r, i) {
        if (String(r[2]).trim() !== jid) return;
        var rowNum = i + 2;
        sheet.getRange(rowNum, 13).setValue("in_progress");
        sheet.getRange(rowNum, 14).setValue("editing");
        sheet.getRange(rowNum, 1, 1, NUM_COLS).setBackground("#fef9c3");
        reset++;
      });
      return respond({ status: "ok", reset: reset });
    }

    // ── Default: upsert evaluation rows ──────────────────────
    // Steps:
    //   1. Deduplicate existing rows for this juror (removes race-condition
    //      duplicates created by rapid instantWrite calls from the client).
    //   2. Build a clean composite-key → row-number index.
    //   3. For each incoming row, update in place or append.

    var ss    = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(EVAL_SHEET);

    if (!sheet) {
      sheet = ss.insertSheet(EVAL_SHEET);
      sheet.appendRow([
        "Juror Name", "Department / Institution", "Juror ID", "Timestamp",
        "Group No", "Group Name",
        "Technical (30)", "Written (30)", "Oral (30)", "Teamwork (10)",
        "Total (100)", "Comments", "Status", "EditingFlag", "Secret",
      ]);
      sheet.getRange(1, 1, 1, NUM_COLS)
        .setFontWeight("bold").setBackground("#1d4ed8").setFontColor("white");
      sheet.setFrozenRows(1);
      ensureJurorIdTextFormat(sheet);
    }

    // Step 1+2: deduplicate and get a fresh index.
    ensureJurorIdTextFormat(sheet);
    var index = buildIndexAndDedupe(sheet, jid);

    // Step 3: collect latest incoming row per group (last one wins if dupes in payload).
    var latestByKey = {};
    (data.rows || []).forEach(function(row) {
      // Security: silently drop any row whose jurorId doesn't match the token.
      if (String(row.jurorId || "").trim() !== jid) return;
      var k = jid + "__" + String(row.projectId || "").trim();
      latestByKey[k] = row;
    });

    var updated = 0, added = 0;

    Object.keys(latestByKey).forEach(function(k) {
      var row        = latestByKey[k];
      var newStatus  = String(row.status || "all_submitted");
      var newFlag    = "";
      var existingRN = index[k];

      if (existingRN) {
        var existingIdx    = existingRN - 2;
        var currentStatus  = String(index[k] ? sheet.getRange(existingRN, 13).getValue() : "") || "";
        var existingRow    = sheet.getRange(existingRN, 1, 1, NUM_COLS).getValues()[0];
        var existingTs     = existingRow[3] ? formatTs(existingRow[3]) : "";
        var incomingTs     = String(row.timestamp   || "");

        // Skip stale updates (older timestamp than what's already stored).
        // existingTs is stored as "dd.MM.yyyy HH:mm:ss" (display format),
        // incomingTs is an ISO string from the client — compare as Date ms.
        var existingTsMs = parseFormattedTs(existingTs);
        var incomingTsMs = incomingTs ? new Date(incomingTs).getTime() : 0;
        if (existingTsMs && incomingTsMs && incomingTsMs < existingTsMs) return;

        // Prevent status from being downgraded from all_submitted unless
        // a reset-unlock window is active for this juror.
        currentStatus = String(existingRow[12] || "");
        if (currentStatus === "all_submitted" && newStatus !== "all_submitted") {
          if (!isResetUnlockActive(jid)) {
            newStatus = "all_submitted";
          }
        }

        newFlag = (newStatus === "all_submitted") ? "" :
                  isResetUnlockActive(jid)        ? "editing" :
                  String(existingRow[13] || "");
      }

      var bgColor =
        newStatus === "in_progress"     ? "#fef9c3" :
        newStatus === "group_submitted" ? "#dcfce7" :
        newStatus === "all_submitted"   ? "#bbf7d0" :
        "#ffffff";

      // Timestamp only advances when at least one score value actually changes.
      // Status-only transitions (group_submitted → all_submitted, editing, etc.)
      // keep the existing timestamp so the column always reflects when scores
      // were last entered, not when the submit button was clicked.
      var scoresChanged = true; // default: always true for new rows (no existingRN)
      if (existingRN) {
        var inT = (row.technical === null || row.technical === undefined) ? "" : row.technical;
        var inD = (row.design    === null || row.design    === undefined) ? "" : row.design;
        var inV = (row.delivery  === null || row.delivery  === undefined) ? "" : row.delivery;
        var inW = (row.teamwork  === null || row.teamwork  === undefined) ? "" : row.teamwork;
        var eT  = (existingRow[6] === null || existingRow[6] === undefined) ? "" : existingRow[6];
        var eD  = (existingRow[7] === null || existingRow[7] === undefined) ? "" : existingRow[7];
        var eV  = (existingRow[8] === null || existingRow[8] === undefined) ? "" : existingRow[8];
        var eW  = (existingRow[9] === null || existingRow[9] === undefined) ? "" : existingRow[9];
        scoresChanged = (String(inT) !== String(eT))
                     || (String(inD) !== String(eD))
                     || (String(inV) !== String(eV))
                     || (String(inW) !== String(eW));
      }
      var tsDisplay = scoresChanged
        ? formatTs(row.timestamp || new Date().toISOString())
        : (existingTs || formatTs(new Date().toISOString()));

      // Backend score clamping — enforce max values even if frontend validation fails.
      // Preserve blanks so 0 remains a valid score.
      var technical = clampScore(row.technical, 30);
      var design    = clampScore(row.design,    30);
      var delivery  = clampScore(row.delivery,  30);
      var teamwork  = clampScore(row.teamwork,  10);
      var total     =
        (typeof technical === "number" ? technical : 0) +
        (typeof design    === "number" ? design    : 0) +
        (typeof delivery  === "number" ? delivery  : 0) +
        (typeof teamwork  === "number" ? teamwork  : 0);

      var jidText = "'" + jid;
      var rowValues = [
        row.juryName,    row.juryDept,    jidText,      tsDisplay,
        row.projectId,   row.projectName,
        technical,       design,          delivery,      teamwork,
        total,           row.comments,    newStatus,     newFlag,
        getPerJurorSecret(jid) || "",
      ];

      if (existingRN) {
        var range = sheet.getRange(existingRN, 1, 1, NUM_COLS);
        range.setValues([rowValues]);
        range.setBackground(bgColor);
        updated++;
      } else {
        sheet.appendRow(rowValues);
        var newRN = sheet.getLastRow();
        sheet.getRange(newRN, 1, 1, NUM_COLS).setBackground(bgColor);
        index[k] = newRN;
        added++;
      }
    });

    return respond({ status: "ok", updated: updated, added: added });

  } catch (err) {
    return respond({ status: "error", message: String(err) });
  }
}

// ════════════════════════════════════════════════════════════
// Draft sheet helpers
// ════════════════════════════════════════════════════════════

function getOrCreateDraftSheet() {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(DRAFT_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(DRAFT_SHEET);
    sheet.appendRow(["DraftKey", "DraftJSON", "UpdatedAt"]);
    sheet.getRange(1, 1, 1, 3)
      .setFontWeight("bold").setBackground("#1d4ed8").setFontColor("white");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(2, 420);
  }
  return sheet;
}

function findDraftRow(sheet, key) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var values = sheet.getRange(2, 1, lastRow - 1, 3).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) return values[i];
  }
  return null;
}

function findDraftRowIndex(sheet, key) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]).trim() === key) return i + 2;
  }
  return 0;
}
