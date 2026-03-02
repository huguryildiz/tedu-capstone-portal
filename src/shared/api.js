// src/shared/api.js
// ============================================================
// Single source of truth for all GAS communication.
//
// generateId(name, dept)
//   Deterministic 8-hex-char jurorId via djb2 hash.
//   Same name+dept → same ID on every device/session.
//
// Token model:
//   createPin / verifyPin → server returns token.
//   Token stored in-memory only (let _token). Clears on every
//   page refresh — juror must re-enter PIN after reload.
//   All write endpoints + token-gated reads require a valid token.
//
// apiSecret:
//   Shared secret read from VITE_API_SECRET env var.
//   Sent as ?secret=X on public PIN endpoints (checkPin,
//   createPin, verifyPin) so the GAS URL alone isn't enough
//   to call the API.
// ============================================================

import { APP_CONFIG, CRITERIA } from "../config";

const SCRIPT_URL = APP_CONFIG?.scriptUrl;
const API_SECRET = APP_CONFIG?.apiSecret || "";

// ── Deterministic juror ID ────────────────────────────────────
// djb2 hash of norm(name) + "__" + norm(dept), returns 8 hex chars.
export function generateId(name, dept) {
  const input = name.trim().toLowerCase() + "__" + dept.trim().toLowerCase();
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash) ^ input.charCodeAt(i);
    hash = hash >>> 0; // keep 32-bit unsigned
  }
  return hash.toString(16).padStart(8, "0");
}

// ── Token storage (in-memory — cleared on every page refresh) ──
// Intentionally NOT persisted to sessionStorage or localStorage.
// After a page refresh the token is gone and the juror must re-enter
// their PIN. Sheets is the single source of truth; PIN re-auth is cheap.
let _token = "";

export function storeToken(token) { _token = token; }
export function getToken()        { return _token; }
export function clearToken()      { _token = ""; }

// ── Fire-and-forget POST ──────────────────────────────────────
export async function postToSheet(body) {
  if (!SCRIPT_URL) return;
  const token = getToken();
  try {
    await fetch(SCRIPT_URL, {
      method:  "POST",
      mode:    "no-cors",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ ...body, token }),
    });
  } catch (_) {}
}

// ── Authenticated GET ─────────────────────────────────────────
export async function getFromSheet(params) {
  if (!SCRIPT_URL) throw new Error("scriptUrl is not configured in config.js.");
  const qs  = new URLSearchParams(params).toString();
  const res = await fetch(`${SCRIPT_URL}?${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = (await res.text()).trim();
  if (raw.toLowerCase().startsWith("<html")) {
    throw new Error("Received HTML from Apps Script — check your deployment URL.");
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Apps Script returned invalid JSON.");
  }
}

// ── Token-gated GET ───────────────────────────────────────────
export async function getFromSheetAuth(params) {
  return getFromSheet({ ...params, token: getToken() });
}

// ── Row builder ───────────────────────────────────────────────
// Column order sent to GAS must match the sheet layout:
//   technical, design (written), delivery (oral), teamwork
export function buildRow(juryName, juryDept, jurorId, scores, comments, project, status) {
  return {
    juryName,
    juryDept,
    jurorId,
    timestamp:   new Date().toISOString(),
    projectId:   project.id,
    projectName: project.name,
    technical:   scores[project.id]?.technical ?? null,
    design:      scores[project.id]?.design    ?? null,
    delivery:    scores[project.id]?.delivery  ?? null,
    teamwork:    scores[project.id]?.teamwork  ?? null,
    total:       calcRowTotal(scores, project.id),
    comments:    comments[project.id] || "",
    status,
  };
}

export function calcRowTotal(scores, pid) {
  return CRITERIA.reduce((s, c) => {
    const v = scores[pid]?.[c.id];
    return s + (typeof v === "number" && Number.isFinite(v) ? v : 0);
  }, 0);
}

// ── PIN API ───────────────────────────────────────────────────

export async function checkPin(jurorId) {
  return getFromSheet({ action: "checkPin", jurorId, secret: API_SECRET });
}

export async function createPin(jurorId, juryName, juryDept) {
  return getFromSheet({
    action: "createPin",
    jurorId,
    juryName: juryName.trim(),
    juryDept: juryDept.trim(),
    secret:   API_SECRET,
  });
}

export async function verifyPin(jurorId, pin) {
  return getFromSheet({
    action:  "verifyPin",
    jurorId,
    pin:     String(pin).trim(),
    secret:  API_SECRET,
  });
}

// ── Juror data fetchers (token-gated) ─────────────────────────

export async function fetchMyScores() {
  const json = await getFromSheetAuth({ action: "myscores" });
  if (json.status === "unauthorized") {
    const err = new Error("unauthorized");
    err.unauthorized = true;
    throw err;
  }
  if (json.status !== "ok") return null;
  return { rows: json.rows || [], editAllowed: json.editAllowed === true };
}

export async function allowJurorEdit(jurorId, adminPass) {
  return getFromSheet({ action: "allowedit", jurorId, pass: adminPass });
}

export async function pingSession() {
  return getFromSheetAuth({ action: "ping" });
}

export async function verifySubmittedCount() {
  const json = await getFromSheetAuth({ action: "verify" });
  if (json.status !== "ok") return 0;
  return json.submittedCount || 0;
}
