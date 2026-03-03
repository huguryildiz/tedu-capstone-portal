// src/shared/api.js
// ============================================================
// All backend communication via Supabase RPCs.
// No GAS URL, no fire-and-forget, no session tokens.
//
// Criteria field name mapping (config.js → DB):
//   config.js ids : technical | design   | delivery | teamwork
//   DB columns    : technical | written  | oral     | teamwork
//
// Mapping is applied ONLY in this file at the API boundary.
// All UI components and useJuryState continue to use config.js ids.
// ============================================================

import { supabase } from "../lib/supabaseClient";
import { CRITERIA } from "../config";

// ── calcRowTotal (kept — used in EvalStep / DoneStep) ─────────
export function calcRowTotal(scores, pid) {
  return CRITERIA.reduce((s, c) => {
    const v = scores[pid]?.[c.id];
    return s + (typeof v === "number" && Number.isFinite(v) ? v : 0);
  }, 0);
}

// ── Semester RPCs ──────────────────────────────────────────────

export async function listSemesters() {
  const { data, error } = await supabase.rpc("rpc_list_semesters");
  if (error) throw error;
  return data || [];
}

export async function getActiveSemester() {
  const { data, error } = await supabase.rpc("rpc_get_active_semester");
  if (error) throw error;
  return data?.[0] || null;
}

// ── Juror auth ─────────────────────────────────────────────────
// Returns { juror_id, juror_name, juror_inst } or null if PIN invalid.
export async function jurorLogin(pin) {
  const { data, error } = await supabase.rpc("rpc_juror_login", {
    pin: String(pin).trim(),
  });
  if (error) throw error;
  return data?.[0] || null;
}

// ── Project listing ────────────────────────────────────────────
// Returns projects for a semester with this juror's existing scores.
// DB column names are normalized back to config.js criterion ids here.
export async function listProjects(semesterId, jurorId) {
  const { data, error } = await supabase.rpc("rpc_list_projects", {
    p_semester_id: semesterId,
    p_juror_id:    jurorId,
  });
  if (error) throw error;

  return (data || []).map((row) => ({
    project_id:     row.project_id,
    group_no:       row.group_no,
    project_title:  row.project_title,
    group_students: row.group_students || "",
    submitted_at:   row.submitted_at,
    // Normalize DB column names → config.js criterion ids
    scores: {
      technical: row.technical ?? null,
      design:    row.written   ?? null,   // written  → design
      delivery:  row.oral      ?? null,   // oral     → delivery
      teamwork:  row.teamwork  ?? null,
    },
    comment: row.comment || "",
    total:   row.total   ?? null,
  }));
}

// ── Score upsert ───────────────────────────────────────────────
// Accepts scores keyed by config.js ids.
// Maps design→p_written and delivery→p_oral before calling RPC.
// Returns computed total integer (from DB trigger).
export async function upsertScore(semesterId, projectId, jurorId, scores, comment) {
  const { data, error } = await supabase.rpc("rpc_upsert_score", {
    p_semester_id: semesterId,
    p_project_id:  projectId,
    p_juror_id:    jurorId,
    p_technical:   scores.technical ?? null,
    p_written:     scores.design    ?? null,   // design   → written
    p_oral:        scores.delivery  ?? null,   // delivery → oral
    p_teamwork:    scores.teamwork  ?? null,
    p_comment:     comment || "",
  });
  if (error) throw error;
  return data; // integer total
}

// ── Admin RPCs ─────────────────────────────────────────────────

export async function adminLogin(password) {
  const { data, error } = await supabase.rpc("rpc_admin_login", {
    p_password: password,
  });
  if (error) throw error;
  return data === true;
}

// Returns all score rows for a semester, normalized to the field
// names that existing admin tab components expect.
export async function adminGetScores(semesterId, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_get_scores", {
    p_semester_id:    semesterId,
    p_admin_password: adminPassword,
  });
  if (error) {
    if (error.code === "P0401" || error.message?.includes("unauthorized")) {
      const e = new Error("unauthorized");
      e.unauthorized = true;
      throw e;
    }
    throw error;
  }

  // Normalize DB names → admin tab field names (matches old GAS row shape)
  return (data || []).map((row) => ({
    jurorId:     row.juror_id,
    juryName:    row.juror_name,
    juryDept:    row.juror_inst,
    projectId:   row.project_id,
    groupNo:     row.group_no,
    projectName: row.project_title,
    // Normalize DB column names → config.js criterion ids
    technical:   row.technical   ?? null,
    design:      row.written     ?? null,   // written → design
    delivery:    row.oral        ?? null,   // oral    → delivery
    teamwork:    row.teamwork    ?? null,
    total:       row.total       ?? null,
    comments:    row.comment     || "",
    timestamp:   row.submitted_at
      ? new Date(row.submitted_at).toISOString()
      : "",
    tsMs: row.submitted_at
      ? new Date(row.submitted_at).getTime()
      : 0,
    status:      row.status,
    editingFlag: "",  // no longer applicable in Supabase model
  }));
}

// Returns all jurors for the semester (including those who haven't scored yet).
export async function adminListJurors(semesterId, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_list_jurors", {
    p_semester_id:    semesterId,
    p_admin_password: adminPassword,
  });
  if (error) {
    if (error.code === "P0401" || error.message?.includes("unauthorized")) {
      const e = new Error("unauthorized");
      e.unauthorized = true;
      throw e;
    }
    throw error;
  }
  return (data || []).map((j) => ({
    jurorId:  j.juror_id,
    juryName: j.juror_name,
    juryDept: j.juror_inst || "",
  }));
}

// Returns per-project summary aggregates + notes, normalized for admin tabs.
export async function adminProjectSummary(semesterId, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_project_summary", {
    p_semester_id:    semesterId,
    p_admin_password: adminPassword,
  });
  if (error) {
    if (error.code === "P0401" || error.message?.includes("unauthorized")) {
      const e = new Error("unauthorized");
      e.unauthorized = true;
      throw e;
    }
    throw error;
  }

  return (data || []).map((row) => ({
    id:          row.project_id,
    groupNo:     row.group_no,
    name:        row.project_title,
    students:    row.group_students || "",
    count:       Number(row.juror_count || 0),
    avg: {
      technical: Number(row.avg_technical || 0),
      design:    Number(row.avg_written   || 0),   // avg_written → design
      delivery:  Number(row.avg_oral      || 0),   // avg_oral    → delivery
      teamwork:  Number(row.avg_teamwork  || 0),
    },
    totalAvg: Number(row.avg_total || 0),
    totalMin: row.min_total ?? 0,
    totalMax: row.max_total ?? 0,
    note:     row.note || "",
  }));
}

export async function adminGetProjectNote(semesterId, projectId, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_get_project_note", {
    p_semester_id:    semesterId,
    p_project_id:     projectId,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data || "";
}

export async function adminSetProjectNote(semesterId, projectId, note, adminPassword) {
  const { error } = await supabase.rpc("rpc_admin_set_project_note", {
    p_semester_id:    semesterId,
    p_project_id:     projectId,
    p_note:           note,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
}
