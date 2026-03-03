// src/admin/utils.js
// ============================================================
// Pure utility functions shared across all admin tab modules.
// No React, no side-effects — safe to import anywhere.
// ============================================================

import { CRITERIA } from "../config";

// ── Numeric coercion ──────────────────────────────────────────
// Strips surrounding quotes (Sheets sometimes wraps numbers in
// quotes) and converts to a finite number, defaulting to 0.
export function toNum(v) {
  const n = Number(
    String(v ?? "").trim().replace(/^"+|"+$/g, "").replace(",", ".")
  );
  return Number.isFinite(n) ? n : 0;
}

// ── Timestamp → milliseconds ──────────────────────────────────
// Priority order:
//   1. ISO 8601 / RFC 2822 — new rows use toISOString(), handled natively.
//   2. EU dot format: dd.mm.yyyy HH:mm[:ss]  ← current format
//   3. EU slash format: dd/mm/yyyy HH:mm[:ss] ← legacy rows
//   4. US format: mm/dd/yyyy [HH:mm[:ss] [AM|PM]]
// Legacy rows stored as locale strings are covered by the regex fallbacks.
export function tsToMillis(ts) {
  if (!ts) return 0;
  const s = String(ts).trim().replace(/\s*,\s*/g, ", ");

  // EU dot: dd.mm.yyyy HH:mm[:ss]
  const euDot = s.match(
    /^([0-3]?\d)\.([0-1]?\d)\.(\d{4}),?\s*([0-2]?\d):([0-5]\d)(?::([0-5]\d))?$/
  );
  if (euDot) {
    return new Date(+euDot[3], +euDot[2] - 1, +euDot[1], +euDot[4], +euDot[5], +(euDot[6] || 0)).getTime() || 0;
  }

  // EU slash: dd/mm/yyyy HH:mm[:ss] (legacy)
  const euSlash = s.match(
    /^([0-3]?\d)\/([0-1]?\d)\/(\d{4}),?\s*([0-2]?\d):([0-5]\d)(?::([0-5]\d))?$/
  );
  if (euSlash) {
    return new Date(+euSlash[3], +euSlash[2] - 1, +euSlash[1], +euSlash[4], +euSlash[5], +(euSlash[6] || 0)).getTime() || 0;
  }

  // US: mm/dd/yyyy [HH:mm[:ss] [AM|PM]]
  const us = s.match(
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i
  );
  if (us) {
    let h = +(us[4] || 0);
    const ap = (us[7] || "").toUpperCase();
    if (ap === "PM" && h < 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return (
      new Date(+us[3], +us[1] - 1, +us[2], h, +(us[5] || 0), +(us[6] || 0)).getTime() || 0
    );
  }

  const native = Date.parse(s);
  if (Number.isFinite(native)) return native;
  return 0;
}

// ── Human-readable timestamp ──────────────────────────────────
// Sheet stores "DD.MM.YYYY HH:mm:ss" as text — return as-is so the
// displayed value always matches the sheet exactly.  Only parse/reformat
// for legacy ISO or slash-format inputs that predate the dot format.
export function formatTs(ts) {
  if (!ts) return "—";
  const s = String(ts).trim();
  // Already in DD.MM.YYYY HH:mm[:ss] — sheet is the source of truth.
  const stored = /^(\d{2}\.\d{2}\.\d{4} \d{2}:\d{2})(?::\d{2})?$/.exec(s);
  if (stored) return stored[1];
  // Fallback for ISO / legacy slash-format rows.
  const ms = tsToMillis(s);
  if (!ms) return s;
  const d   = new Date(ms);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── Dashboard timestamp formatting ───────────────────────────
export function formatDashboardTs(date) {
  if (!date) return "—";
  return date.toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).replace(",", " ·").replace(/\//g, ".");
}

// ── Generic comparator (number-aware) ────────────────────────
export function cmp(a, b) {
  const an = Number(a), bn = Number(b);
  if (Number.isFinite(an) && Number.isFinite(bn)) return an - bn;
  return String(a ?? "").toLowerCase() < String(b ?? "").toLowerCase() ? -1 : 1;
}

// ── Stable per-row key ───────────────────────────────────────
export const rowKey = (r) =>
  r.jurorId
    ? r.jurorId
    : `${(r.juryName || "").trim().toLowerCase()}__${(r.juryDept || "").trim().toLowerCase()}`;

// ── Deterministic pastel colour from a name string ───────────
function hashInt(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h  = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function hsl2hex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) =>
    Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))))
      .toString(16).padStart(2, "0");
  return `#${f(0)}${f(8)}${f(4)}`;
}

export const jurorBg  = (n) => hsl2hex(hashInt(n || "?") % 360, 55, 95);
export const jurorDot = (n) => hsl2hex(hashInt(n || "?") % 360, 65, 55);

// ── Excel (.xlsx) export ──────────────────────────────────────
function exportScoreValue(v) {
  if (v === "" || v === null || v === undefined) return "";
  if (typeof v === "string" && v.trim() === "") return "";
  if (typeof v === "number" && !Number.isFinite(v)) return "";
  return v;
}

export async function exportXLSX(rows, { semesterName = "", summaryData = [] } = {}) {
  const XLSX = await import("xlsx");

  // Build projectId → group_students lookup from summaryData
  const studentsMap = new Map(
    (summaryData || []).map((p) => [p.id, p.students ?? ""])
  );

  const headers = [
    "semester",
    "group_no",
    "project_title",
    "group_students",
    "juror_name",
    "juror_inst",
    "technical",
    "written",
    "oral",
    "teamwork",
    "total",
    "submitted_at",
    "comment",
  ];

  const data = rows.map((r) => [
    semesterName,
    r.groupNo     ?? "",
    r.projectName ?? "",
    studentsMap.get(r.projectId) ?? "",
    r.juryName    ?? "",
    r.juryDept    ?? "",
    exportScoreValue(r.technical),
    exportScoreValue(r.design),    // written in DB
    exportScoreValue(r.delivery),  // oral in DB
    exportScoreValue(r.teamwork),
    exportScoreValue(r.total),
    r.timestamp   ?? "",           // submitted_at
    r.comments    ?? "",
  ]);

  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
  // semester(A), group_no(B), project_title(C), group_students(D),
  // juror_name(E), juror_inst(F), technical(G), written(H), oral(I),
  // teamwork(J), total(K), submitted_at(L), comment(M)
  ws["!cols"] = [18, 8, 32, 42, 24, 26, 11, 9, 7, 11, 8, 24, 32].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Jury Evaluations");
  const now  = new Date();
  const date = now.toISOString().slice(0, 10);
  const hhmm = `${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}`;
  XLSX.writeFile(wb, `jury_export_${date}_${hhmm}.xlsx`);
}

// ── Completion % — mirrors countFilled / totalFields in useJuryState ─────────
// r[c.id] > 0 matches admin field names (technical/design/delivery/teamwork)
// which equal CRITERIA ids. 0 == not filled (toNum default).
const countAdminFilledCriteria = (rows) =>
  rows.reduce((t, r) => t + CRITERIA.filter((c) => r[c.id] > 0).length, 0);

export const adminCompletionPct = (rows, totalProjects) => {
  const total = (totalProjects || 0) * CRITERIA.length;
  return total === 0 ? 0 : Math.round((countAdminFilledCriteria(rows) / total) * 100);
};

// ── Row deduplication ─────────────────────────────────────────
// Keeps the single best row per (juror + dept + group) composite key.
// "Best" = latest timestamp, with status priority as tiebreaker.
export function dedupeAndSort(rows) {
  const priority = { all_submitted: 3, group_submitted: 2, in_progress: 1 };

  const cleaned = (rows || [])
    .filter((r) => r?.juryName || r?.projectName || (r?.total ?? 0) > 0)
    .map((r) => ({
      ...r,
      tsMs: Number.isFinite(r?.tsMs) ? r.tsMs : tsToMillis(r?.timestamp),
    }));

  const byKey = new Map();

  for (const r of cleaned) {
    const jur = String(r.juryName ?? "").trim().toLowerCase();
    const dep = String(r.juryDept ?? "").trim().toLowerCase();
    const grp = r.projectId
      ? String(r.projectId).trim()
      : String(r.projectName ?? "").trim().toLowerCase();

    if (!jur || !grp) continue;
    const key  = `${jur}__${dep}__${grp}`;
    const prev = byKey.get(key);

    if (!prev) { byKey.set(key, r); continue; }

    // Prefer newer timestamp.
    if ((r.tsMs || 0) > (prev.tsMs || 0)) { byKey.set(key, r); continue; }
    // Same timestamp: prefer higher-priority status.
    if (
      (r.tsMs || 0) === (prev.tsMs || 0) &&
      (priority[r.status] || 0) > (priority[prev.status] || 0)
    ) {
      byKey.set(key, r);
    }
  }

  return [...byKey.values()].sort((a, b) => (b.tsMs || 0) - (a.tsMs || 0));
}
