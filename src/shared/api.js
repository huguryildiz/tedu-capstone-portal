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
// Returns { juror_id, juror_name, juror_inst, needs_pin, pin_plain_once, locked_until, failed_attempts }.
export async function createOrGetJurorAndIssuePin(semesterId, jurorName, jurorInst) {
  const { data, error } = await supabase.rpc("rpc_create_or_get_juror_and_issue_pin", {
    p_semester_id: semesterId,
    p_juror_name:  String(jurorName || "").trim(),
    p_juror_inst:  String(jurorInst || "").trim(),
  });
  if (error) throw error;
  return data?.[0] || null;
}

// Returns { ok, juror_id, juror_name, juror_inst, error_code, locked_until, failed_attempts, pin_plain_once }.
export async function verifyJurorPin(semesterId, jurorName, jurorInst, pin) {
  const { data, error } = await supabase.rpc("rpc_verify_juror_pin", {
    p_semester_id: semesterId,
    p_juror_name:  String(jurorName || "").trim(),
    p_juror_inst:  String(jurorInst || "").trim(),
    p_pin:         String(pin || "").trim(),
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function getJurorById(jurorId) {
  const { data, error } = await supabase.rpc("rpc_get_juror_by_id", {
    p_juror_id: jurorId,
  });
  if (error) throw error;
  return data?.[0] || null;
}

// ── Project listing ────────────────────────────────────────────
// Returns projects for a semester with this juror's existing scores.
// DB column names are normalized back to config.js criterion ids here.
export async function listProjects(semesterId, jurorId = null) {
  const { data, error } = await supabase.rpc("rpc_list_projects", {
    p_semester_id: semesterId,
    p_juror_id:    jurorId ?? null,
  });
  if (error) throw error;

  return (data || []).map((row) => ({
    project_id:     row.project_id,
    group_no:       row.group_no,
    project_title:  row.project_title,
    group_students: row.group_students || "",
    updated_at:     row.updated_at,
    final_submitted_at: row.final_submitted_at,
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
  return (data || []).map((row) => {
    const hasAnyScore =
      row.technical != null ||
      row.written   != null ||
      row.oral      != null ||
      row.teamwork  != null;
    const hasAllScores =
      row.technical != null &&
      row.written   != null &&
      row.oral      != null &&
      row.teamwork  != null;
    const hasComment = String(row.comment || "").trim().length > 0;
    const finalSubmittedAtRaw = row.final_submitted_at || "";
    const isFinalSubmitted = !!finalSubmittedAtRaw;
    const status = row.status || (
      isFinalSubmitted || hasAllScores
        ? "submitted"
        : (!hasAnyScore && !hasComment ? "not_started" : "in_progress")
    );

    const updatedAt = row.updated_at ? new Date(row.updated_at).toISOString() : "";
    const updatedMs = row.updated_at ? new Date(row.updated_at).getTime() : 0;
    const finalSubmittedAt = finalSubmittedAtRaw ? new Date(finalSubmittedAtRaw).toISOString() : "";
    const finalSubmittedMs = finalSubmittedAtRaw ? new Date(finalSubmittedAtRaw).getTime() : 0;

    return ({
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
      updatedAt,
      updatedMs,
      finalSubmittedAt,
      finalSubmittedMs,
      // Legacy timestamp fields now represent "last edited"
      timestamp:   updatedAt,
      tsMs:        updatedMs,
      status,
      editingFlag: "",  // no longer applicable in Supabase model
    });
  });
}

// Returns all jurors for the semester (including those who haven't scored yet).
export async function adminListJurors(semesterId, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_list_jurors", {
    p_admin_password: adminPassword,
    p_semester_id:    semesterId,
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
    scoredSemesters: Array.isArray(j.scored_semesters) ? j.scored_semesters : [],
    isAssigned: j.is_assigned,
    editEnabled: j.edit_enabled,
    finalSubmittedAt: j.final_submitted_at || "",
    finalSubmitted: Boolean(j.final_submitted_at),
    lastActivityAt: j.last_activity_at || "",
    lastActivityMs: j.last_activity_at ? new Date(j.last_activity_at).getTime() : 0,
    lastSeenAt: j.last_seen_at || "",
    lastSeenMs: j.last_seen_at ? new Date(j.last_seen_at).getTime() : 0,
    totalProjects: j.total_projects,
    completedProjects: j.completed_projects,
    lockedUntil: j.locked_until,
    isLocked: j.is_locked,
  }));
}

// Returns per-project summary aggregates, normalized for admin tabs.
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

// ── Admin manage RPCs ─────────────────────────────────────────

export async function adminSetActiveSemester(semesterId, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_set_active_semester", {
    p_semester_id: semesterId,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data;
}

export async function adminCreateSemester(payload, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_create_semester", {
    p_name: payload.name,
    p_starts_on: payload.starts_on,
    p_ends_on: payload.ends_on,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function adminUpdateSemester(payload, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_update_semester", {
    p_semester_id: payload.id,
    p_name: payload.name,
    p_starts_on: payload.starts_on,
    p_ends_on: payload.ends_on,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function adminListProjects(semesterId, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_list_projects", {
    p_semester_id: semesterId,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data || [];
}

export async function adminCreateProject(payload, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_create_project", {
    p_semester_id: payload.semesterId,
    p_group_no: payload.group_no,
    p_project_title: payload.project_title,
    p_group_students: payload.group_students,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function adminUpsertProject(payload, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_upsert_project", {
    p_semester_id: payload.semesterId,
    p_group_no: payload.group_no,
    p_project_title: payload.project_title,
    p_group_students: payload.group_students,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function adminCreateJuror(payload, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_create_juror", {
    p_juror_name: payload.juror_name,
    p_juror_inst: payload.juror_inst,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function adminUpdateJuror(payload, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_update_juror", {
    p_juror_id: payload.jurorId,
    p_juror_name: payload.juror_name,
    p_juror_inst: payload.juror_inst,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data === true;
}

export async function adminResetJurorPin(payload, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_reset_juror_pin", {
    p_semester_id: payload.semesterId,
    p_juror_id: payload.jurorId,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function adminSetJurorEditMode(payload, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_set_juror_edit_mode", {
    p_semester_id: payload.semesterId,
    p_juror_id: payload.jurorId,
    p_enabled: !!payload.enabled,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data === true;
}

export async function adminGetSettings(adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_get_settings", {
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data || [];
}

export async function adminListAuditLogs(filters, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_list_audit_logs", {
    p_admin_password: adminPassword,
    p_start_at: filters?.startAt || null,
    p_end_at: filters?.endAt || null,
    p_actor_types: filters?.actorTypes || null,
    p_actions: filters?.actions || null,
    p_limit: filters?.limit || 120,
  });
  if (error) {
    if (error.code === "P0401" || error.message?.includes("unauthorized")) {
      const e = new Error("unauthorized");
      e.unauthorized = true;
      throw e;
    }
    throw error;
  }
  return data || [];
}

export async function adminSetSetting(key, value, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_set_setting", {
    p_key: key,
    p_value: value,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data;
}

export async function getJurorEditState(semesterId, jurorId) {
  const { data, error } = await supabase.rpc("rpc_get_juror_edit_state", {
    p_semester_id: semesterId,
    p_juror_id: jurorId,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function finalizeJurorSubmission(semesterId, jurorId) {
  const { data, error } = await supabase.rpc("rpc_finalize_juror_submission", {
    p_semester_id: semesterId,
    p_juror_id: jurorId,
  });
  if (error) throw error;
  return data === true;
}

export async function adminChangePassword(currentPassword, newPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_change_password", {
    p_current_password: currentPassword,
    p_new_password: newPassword,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function adminBootstrapPassword(newPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_bootstrap_password", {
    p_new_password: newPassword,
  });
  if (error) throw error;
  return data?.[0] || null;
}

export async function adminBootstrapBackupPassword(newPassword, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_bootstrap_backup_password", {
    p_new_password: newPassword,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data === true;
}

export async function adminChangeBackupPassword(currentPassword, newPassword, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_change_backup_password", {
    p_current_password: currentPassword,
    p_new_password: newPassword,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data === true;
}

export async function adminFullExport(backupPassword, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_full_export", {
    p_backup_password: backupPassword,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data;
}

export async function adminFullImport(backup, backupPassword, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_full_import", {
    p_backup_password: backupPassword,
    p_admin_password: adminPassword,
    p_data: backup,
  });
  if (error) throw error;
  return data;
}

export async function adminChangeDeletePassword(currentPassword, newPassword, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_change_delete_password", {
    p_current_password: currentPassword,
    p_new_password: newPassword,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data === true || data?.[0] || null;
}

export async function adminDeleteSemester(semesterId, deletePassword) {
  const { data, error } = await supabase.rpc("rpc_admin_delete_semester", {
    p_semester_id: semesterId,
    p_delete_password: deletePassword,
  });
  if (error) throw error;
  return data === true;
}

export async function adminDeleteProject(projectId, deletePassword) {
  const { data, error } = await supabase.rpc("rpc_admin_delete_project", {
    p_project_id: projectId,
    p_delete_password: deletePassword,
  });
  if (error) throw error;
  return data === true;
}

export async function adminDeleteJuror(jurorId, deletePassword) {
  const { data, error } = await supabase.rpc("rpc_admin_delete_juror", {
    p_juror_id: jurorId,
    p_delete_password: deletePassword,
  });
  if (error) throw error;
  return data === true;
}

export async function adminDeleteCounts(targetType, targetId, adminPassword) {
  const { data, error } = await supabase.rpc("rpc_admin_delete_counts", {
    p_type: targetType,
    p_id: targetId,
    p_admin_password: adminPassword,
  });
  if (error) throw error;
  return data;
}

export async function adminDeleteEntity({ targetType, targetId, deletePassword }) {
  if (!targetType || !targetId) throw new Error("targetType and targetId are required.");
  if (targetType === "semester") return adminDeleteSemester(targetId, deletePassword);
  if (targetType === "project") return adminDeleteProject(targetId, deletePassword);
  if (targetType === "juror") return adminDeleteJuror(targetId, deletePassword);
  throw new Error("Unsupported delete target.");
}
