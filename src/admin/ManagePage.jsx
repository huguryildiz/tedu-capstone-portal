// src/admin/ManagePage.jsx
// ============================================================
// Admin Manage page: semesters, projects, jurors, permissions.
// ============================================================

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  listSemesters,
  adminListJurors,
  adminGetScores,
  adminSetActiveSemester,
  adminCreateSemester,
  adminUpdateSemester,
  adminListProjects,
  adminCreateProject,
  adminUpsertProject,
  adminCreateJuror,
  adminUpdateJuror,
  adminResetJurorPin,
  adminSetJurorEditMode,
  adminDeleteEntity,
  adminDeleteCounts,
  adminGetSettings,
  adminListAuditLogs,
  adminSetSetting,
  adminFullExport,
  adminFullImport,
} from "../shared/api";
import { supabase } from "../lib/supabaseClient";
import { ChevronDownIcon, DatabaseIcon, DownloadIcon, HistoryIcon, UploadIcon } from "../shared/Icons";
import { exportXLSX, buildExportFilename } from "./utils";
import ManageSemesterPanel from "./ManageSemesterPanel";
import ManageProjectsPanel from "./ManageProjectsPanel";
import ManageJurorsPanel from "./ManageJurorsPanel";
import ManagePermissionsPanel from "./ManagePermissionsPanel";
import AdminSecurityPanel from "../components/admin/AdminSecurityPanel";
import DeleteConfirmDialog from "../components/admin/DeleteConfirmDialog";

const SETTINGS_KEYS = {
  evalLock: "eval_lock_active_semester",
};

const defaultSettings = {
  evalLockActive: false,
};

const defaultAuditFilters = {
  startDate: "",
  endDate: "",
};

const formatAuditTimestamp = (value) => {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  const day = String(dt.getDate()).padStart(2, "0");
  const month = dt.toLocaleString("en-GB", { month: "short" });
  const year = dt.getFullYear();
  const hours = String(dt.getHours()).padStart(2, "0");
  const minutes = String(dt.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} ${hours}:${minutes}`;
};

const isValidDateParts = (yyyy, mm, dd) => {
  if (yyyy < 2000 || yyyy > 2100) return false;
  if (mm < 1 || mm > 12) return false;
  if (dd < 1) return false;
  const maxDays = new Date(yyyy, mm, 0).getDate();
  return dd <= maxDays;
};

const isValidTimeParts = (hh, mi, ss) => {
  if (hh < 0 || hh > 23) return false;
  if (mi < 0 || mi > 59) return false;
  if (ss < 0 || ss > 59) return false;
  return true;
};

const parseAuditDateString = (value) => {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) {
    const [datePart, timePart] = value.split("T");
    const [yyyy, mm, dd] = datePart.split("-").map(Number);
    const [hh, mi, ss = "0"] = timePart.split(":").map(Number);
    if (!isValidDateParts(yyyy, mm, dd)) return null;
    if (!isValidTimeParts(hh, mi, ss)) return null;
    return { ms: new Date(yyyy, mm - 1, dd, hh, mi, ss).getTime(), isDateOnly: false };
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [yyyy, mm, dd] = value.split("-").map(Number);
    if (!isValidDateParts(yyyy, mm, dd)) return null;
    return { ms: new Date(yyyy, mm - 1, dd).getTime(), isDateOnly: true };
  }
  return null;
};

const getAuditDateRangeError = (filters) => {
  const start = filters?.startDate || "";
  const end = filters?.endDate || "";
  const parsedStart = start ? parseAuditDateString(start) : null;
  const parsedEnd = end ? parseAuditDateString(end) : null;
  if ((start && !parsedStart) || (end && !parsedEnd)) {
    return "Invalid date format. Use YYYY-MM-DDThh:mm.";
  }
  if (parsedStart && parsedEnd && parsedStart.ms > parsedEnd.ms) {
    return "The 'From' date/time cannot be later than the 'To' date/time.";
  }
  return "";
};

const buildAuditParams = (filters) => {
  let startAt = null;
  let endAt = null;
  if (filters.startDate) {
    const parsed = parseAuditDateString(filters.startDate);
    if (parsed) {
      startAt = new Date(parsed.ms);
    }
  }
  if (filters.endDate) {
    const parsed = parseAuditDateString(filters.endDate);
    if (parsed) {
      const endMs = parsed.ms + (parsed.isDateOnly ? (24 * 60 * 60 * 1000 - 1) : 0);
      endAt = new Date(endMs);
    }
  }
  return {
    startAt: startAt ? startAt.toISOString() : null,
    endAt: endAt ? endAt.toISOString() : null,
    actorTypes: null,
    actions: null,
    limit: 120,
  };
};

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e) => setMatches(e.matches);
    if (mql.addEventListener) mql.addEventListener("change", handler);
    else mql.addListener(handler);
    return () => {
      if (mql.removeEventListener) mql.removeEventListener("change", handler);
      else mql.removeListener(handler);
    };
  }, [query]);
  return matches;
}

export default function ManagePage({ adminPass, onAdminPasswordChange }) {
  const isMobile = useMediaQuery("(max-width: 900px)");
  const [openPanels, setOpenPanels] = useState({
    semester: true,
    projects: true,
    jurors: true,
    permissions: true,
    security: true,
    audit: true,
    export: true,
    dbbackup: true,
  });

  const [semesterList, setSemesterList] = useState([]);
  const [activeSemesterId, setActiveSemesterId] = useState("");
  const [projects, setProjects] = useState([]);
  const [jurors, setJurors] = useState([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [resetPinInfo, setResetPinInfo] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleteCounts, setDeleteCounts] = useState(null);
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditError, setAuditError] = useState("");
  const [auditFilters, setAuditFilters] = useState(defaultAuditFilters);
  const [auditSearch, setAuditSearch] = useState("");
  const jurorTimerRef = useRef(null);  // debounce for loadJurors-only refetch
  const auditTimerRef = useRef(null);  // debounce for loadAuditLogs refetch
  const adminSecurityRef = useRef(null);
  const auditCardRef = useRef(null);
  const importFileRef = useRef(null);

  const [dbBackupMode, setDbBackupMode] = useState(null); // null | 'export' | 'import'
  const [dbBackupPassword, setDbBackupPassword] = useState("");
  const [dbImportData, setDbImportData] = useState(null);
  const [dbBackupLoading, setDbBackupLoading] = useState(false);
  const [dbBackupError, setDbBackupError] = useState("");

  useEffect(() => {
    if (!message && !error) return;
    const timer = setTimeout(() => {
      setMessage("");
      setError("");
    }, 5000);
    return () => clearTimeout(timer);
  }, [message, error]);

  const activeSemester = useMemo(
    () => semesterList.find((s) => s.id === activeSemesterId) || null,
    [semesterList, activeSemesterId]
  );

  const togglePanel = (id) => {
    setOpenPanels((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const loadSemesters = useCallback(async () => {
    const sems = await listSemesters();
    setSemesterList(sems);
    const active = sems.find((s) => s.is_active) || sems[0];
    setActiveSemesterId(active?.id || "");
  }, []);

  const refreshSemesters = useCallback(async () => {
    const sems = await listSemesters();
    setSemesterList(sems);
    if (!activeSemesterId || !sems.some((s) => s.id === activeSemesterId)) {
      const active = sems.find((s) => s.is_active) || sems[0];
      setActiveSemesterId(active?.id || "");
    }
  }, [activeSemesterId]);

  const loadProjects = useCallback(async (semesterId) => {
    if (!semesterId || !adminPass) return;
    const rows = await adminListProjects(semesterId, adminPass);
    setProjects(rows || []);
  }, [adminPass]);

  const loadJurors = useCallback(async () => {
    if (!adminPass) return;
    const rows = await adminListJurors(activeSemesterId, adminPass);
    setJurors(rows || []);
  }, [adminPass, activeSemesterId]);

  const loadSettings = useCallback(async () => {
    if (!adminPass) return;
    const rows = await adminGetSettings(adminPass);
    const map = new Map((rows || []).map((r) => [r.key, r.value]));
    const evalLockActive = map.get(SETTINGS_KEYS.evalLock) === "true";
    setSettings({
      evalLockActive,
    });
  }, [adminPass]);

  const loadAuditLogs = useCallback(async (filters) => {
    if (!adminPass) return;
    setAuditLoading(true);
    setAuditError("");
    const rangeError = getAuditDateRangeError(filters || defaultAuditFilters);
    if (rangeError) {
      setAuditError(rangeError);
      setAuditLogs([]);
      setAuditLoading(false);
      return;
    }
    try {
      const params = buildAuditParams(filters || defaultAuditFilters);
      const rows = await adminListAuditLogs(params, adminPass);
      setAuditLogs(rows || []);
    } catch (e) {
      setAuditError(e?.message || "Could not load audit logs.");
    } finally {
      setAuditLoading(false);
    }
  }, [adminPass]);

  const applySemesterPatch = useCallback((patch) => {
    if (!patch?.id) return;
    setSemesterList((prev) => {
      const next = [...prev];
      const idx = next.findIndex((s) => s.id === patch.id);
      if (idx >= 0) {
        next[idx] = {
          ...next[idx],
          ...patch,
          updated_at: patch.updated_at || next[idx].updated_at || new Date().toISOString(),
        };
      } else {
        next.push({
          ...patch,
          updated_at: patch.updated_at || new Date().toISOString(),
        });
      }
      return next;
    });
  }, []);

  const applyProjectPatch = useCallback((patch) => {
    if (!patch) return;
    setProjects((prev) => {
      const next = [...prev];
      const idx = next.findIndex(
        (p) =>
          (patch.id && p.id === patch.id)
          || (
            patch.group_no != null
            && p.group_no === patch.group_no
            && (!patch.semester_id || p.semester_id === patch.semester_id)
          )
      );
      const updated = {
        ...((idx >= 0 ? next[idx] : {}) || {}),
        ...patch,
        updated_at: patch.updated_at || (idx >= 0 ? next[idx]?.updated_at : null) || new Date().toISOString(),
      };
      if (idx >= 0) next[idx] = updated;
      else next.push(updated);
      return next;
    });
  }, []);

  const applyJurorPatch = useCallback((patch) => {
    if (!patch) return;
    const jurorId = patch.juror_id || patch.jurorId || patch.id;
    if (!jurorId) return;
    setJurors((prev) => {
      const next = [...prev];
      const idx = next.findIndex((j) => (j.juror_id || j.jurorId) === jurorId);
      const updated = {
        ...((idx >= 0 ? next[idx] : {}) || {}),
        ...patch,
      };
      if (idx >= 0) next[idx] = updated;
      else next.push(updated);
      return next;
    });
  }, []);

  useEffect(() => {
    setLoading(true);
    setError("");
    loadSemesters()
      .catch(() => setError("Could not load semesters."))
      .finally(() => setLoading(false));
  }, [loadSemesters]);

  useEffect(() => {
    if (!activeSemesterId) return;
    if (!adminPass) {
      setError("Admin password missing. Please re-login.");
      return;
    }
    setLoading(true);
    Promise.all([
      loadProjects(activeSemesterId),
      loadJurors(),
      loadSettings(),
    ])
      .catch((e) => setError(e?.message || "Could not load manage data."))
      .finally(() => setLoading(false));
  }, [activeSemesterId, adminPass, loadProjects, loadJurors, loadSettings]);

  useEffect(() => {
    if (!adminPass) return;
    loadAuditLogs(auditFilters);
  }, [adminPass, auditFilters, loadAuditLogs]);

  // Background refresh (no full-page reload).
  useEffect(() => {
    if (!adminPass) return;
    const interval = setInterval(() => {
      if (!activeSemesterId) return;
      Promise.all([
        loadProjects(activeSemesterId),
        loadJurors(),
        loadSettings(),
      ]).catch(() => {});
      refreshSemesters().catch(() => {});
    }, 5_000);
    return () => clearInterval(interval);
  }, [adminPass, activeSemesterId, loadProjects, loadJurors, loadSettings, refreshSemesters]);

  const visibleAuditLogs = useMemo(() => {
    const query = auditSearch.trim().toLowerCase();
    if (!query) return auditLogs;
    return auditLogs.filter((log) => {
      const message = String(log?.message || "").toLowerCase();
      const action = String(log?.action || "").toLowerCase();
      const actor = String(log?.actor_type || "").toLowerCase();
      const entity = String(log?.entity_type || "").toLowerCase();
      return (
        message.includes(query)
        || action.includes(query)
        || actor.includes(query)
        || entity.includes(query)
      );
    });
  }, [auditLogs, auditSearch]);

  useLayoutEffect(() => {
    const adminEl = adminSecurityRef.current;
    const auditEl = auditCardRef.current;
    if (!adminEl || !auditEl) return undefined;

    if (isMobile) {
      auditEl.style.height = "";
      return undefined;
    }

    const syncHeight = () => {
      const height = adminEl.getBoundingClientRect().height;
      if (height) {
        auditEl.style.height = `${height}px`;
      }
    };

    syncHeight();

    let observer;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(() => syncHeight());
      observer.observe(adminEl);
    } else {
      window.addEventListener("resize", syncHeight);
    }

    return () => {
      if (observer) {
        observer.disconnect();
      } else {
        window.removeEventListener("resize", syncHeight);
      }
    };
  }, [isMobile, openPanels.security]);

  // Debounced juror-only refetch (enriched data: auth status, completion counts, etc.)
  const scheduleJurorRefresh = useCallback(() => {
    if (!adminPass) return;
    if (jurorTimerRef.current) return;
    jurorTimerRef.current = setTimeout(() => {
      jurorTimerRef.current = null;
      loadJurors().catch(() => {});
    }, 400);
  }, [adminPass, loadJurors]);

  // Debounced audit log refetch (respects current filters)
  const scheduleAuditRefresh = useCallback(() => {
    if (!adminPass) return;
    if (auditTimerRef.current) clearTimeout(auditTimerRef.current);
    auditTimerRef.current = setTimeout(() => {
      auditTimerRef.current = null;
      loadAuditLogs(auditFilters).catch(() => {});
    }, 600);
  }, [adminPass, auditFilters, loadAuditLogs]);

  useEffect(() => {
    if (!adminPass) return;

    const channel = supabase
      .channel("admin-manage-live")

      // ── semesters: patch in-place, no full reload ──────────
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "semesters" }, (payload) => {
        if (payload.new?.id) applySemesterPatch(payload.new);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "semesters" }, (payload) => {
        if (payload.new?.id) {
          applySemesterPatch(payload.new);
          if (payload.new.is_active) setActiveSemesterId(payload.new.id);
        }
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "semesters" }, (payload) => {
        const deletedId = payload.old?.id;
        if (!deletedId) return;
        setSemesterList((prev) => {
          const next = prev.filter((s) => s.id !== deletedId);
          setActiveSemesterId((cur) => {
            if (cur !== deletedId) return cur;
            const active = next.find((s) => s.is_active) || next[0];
            return active?.id || "";
          });
          return next;
        });
      })

      // ── projects: patch in-place for active semester ───────
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "projects" }, (payload) => {
        if (payload.new?.semester_id === activeSemesterId) applyProjectPatch(payload.new);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "projects" }, (payload) => {
        if (payload.new?.semester_id === activeSemesterId) applyProjectPatch(payload.new);
      })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "projects" }, (payload) => {
        const deletedId = payload.old?.id;
        if (deletedId) setProjects((prev) => prev.filter((p) => p.id !== deletedId));
      })

      // ── settings: patch settings state inline ─────────────
      .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, (payload) => {
        const row = payload.new;
        if (!row?.key) return;
        if (row.key === SETTINGS_KEYS.evalLock) {
          setSettings((prev) => ({ ...prev, evalLockActive: row.value === "true" }));
        }
      })

      // ── jurors / auth / scores: enriched → refetch jurors only
      .on("postgres_changes", { event: "*", schema: "public", table: "jurors" }, scheduleJurorRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "juror_semester_auth" }, scheduleJurorRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "scores" }, scheduleJurorRefresh)

      // ── audit_logs: debounced reload respecting filters ────
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "audit_logs" }, scheduleAuditRefresh)

      .subscribe();

    return () => {
      if (jurorTimerRef.current) { clearTimeout(jurorTimerRef.current); jurorTimerRef.current = null; }
      if (auditTimerRef.current) { clearTimeout(auditTimerRef.current); auditTimerRef.current = null; }
      supabase.removeChannel(channel);
    };
  }, [
    adminPass,
    activeSemesterId,
    applySemesterPatch,
    applyProjectPatch,
    scheduleJurorRefresh,
    scheduleAuditRefresh,
  ]);

  const handleSetActiveSemester = async (semesterId) => {
    setMessage("");
    setError("");
    if (!adminPass) return setError("Admin password missing.");
    setLoading(true);
    try {
      await adminSetActiveSemester(semesterId, adminPass);
      setSemesterList((prev) =>
        prev.map((s) => ({ ...s, is_active: s.id === semesterId }))
      );
      setActiveSemesterId(semesterId);
      setMessage("Active semester updated.");
    } catch (e) {
      setError(e?.message || "Could not update active semester.");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateSemester = async (payload) => {
    setMessage("");
    setError("");
    if (!adminPass) return setError("Admin password missing.");
    setLoading(true);
    try {
      const created = await adminCreateSemester(payload, adminPass);
      if (created?.id) {
        applySemesterPatch(created);
      } else {
        applySemesterPatch({
          id: `temp-${Date.now()}`,
          name: payload.name,
          starts_on: payload.starts_on,
          ends_on: payload.ends_on,
          is_active: false,
        });
      }
      setMessage("Semester created.");
    } catch (e) {
      const msg = String(e?.message || "");
      const msgLower = msg.toLowerCase();
      if (msg.includes("semester_name_exists")
        || msgLower.includes("semesters_name_ci_unique")
        || msgLower.includes("duplicate key value violates unique constraint")) {
        setError("Semester name already exists.");
      } else if (msg.includes("semester_name_required")) {
        setError("Semester name is required.");
      } else {
        setError(msg || "Could not create semester.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateSemester = async (payload) => {
    setMessage("");
    setError("");
    if (!adminPass) return setError("Admin password missing.");
    setLoading(true);
    try {
      await adminUpdateSemester(payload, adminPass);
      applySemesterPatch({
        id: payload.id,
        name: payload.name,
        starts_on: payload.starts_on,
        ends_on: payload.ends_on,
      });
      setMessage("Semester updated.");
    } catch (e) {
      const msg = String(e?.message || "");
      const msgLower = msg.toLowerCase();
      if (msg.includes("semester_name_exists")
        || msgLower.includes("semesters_name_ci_unique")
        || msgLower.includes("duplicate key value violates unique constraint")) {
        setError("Semester name already exists.");
      } else if (msg.includes("semester_name_required")) {
        setError("Semester name is required.");
      } else {
        setError(msg || "Could not update semester.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleImportProjects = async (rows) => {
    if (!activeSemesterId) return;
    setMessage("");
    setError("");
    setLoading(true);
    try {
      let skipped = 0;
      for (const row of rows) {
        try {
          const res = await adminCreateProject({ ...row, semesterId: activeSemesterId }, adminPass);
          applyProjectPatch({
            id: res?.project_id || res?.projectId || undefined,
            semester_id: activeSemesterId,
            group_no: row.group_no,
            project_title: row.project_title,
            group_students: row.group_students,
          });
        } catch (e) {
          const msg = String(e?.message || "");
          const msgLower = msg.toLowerCase();
          if (msg.includes("project_group_exists")
            || msgLower.includes("projects_semester_group_no_key")
            || msgLower.includes("duplicate key value violates unique constraint")) {
            skipped += 1;
            continue;
          }
          throw e;
        }
      }
      setMessage(
        skipped > 0
          ? `Projects imported. Skipped ${skipped} existing groups.`
          : "Projects imported."
      );
      return { skipped };
    } catch (e) {
      const msg = String(e?.message || "");
      const msgLower = msg.toLowerCase();
      if (msg.includes("project_group_exists")
        || msgLower.includes("projects_semester_group_no_key")
        || msgLower.includes("duplicate key value violates unique constraint")) {
        setError("Some groups already exist. Refresh and try again.");
      } else {
        setError(msg || "Could not import projects.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleAddProject = async (row) => {
    if (!activeSemesterId) return;
    setMessage("");
    setError("");
    setLoading(true);
    try {
      const res = await adminCreateProject({ ...row, semesterId: activeSemesterId }, adminPass);
      applyProjectPatch({
        id: res?.project_id || res?.projectId || undefined,
        semester_id: activeSemesterId,
        group_no: row.group_no,
        project_title: row.project_title,
        group_students: row.group_students,
      });
      setMessage("Group saved.");
    } catch (e) {
      const msg = String(e?.message || "");
      const msgLower = msg.toLowerCase();
      if (msg.includes("project_group_exists")
        || msgLower.includes("projects_semester_group_no_key")
        || msgLower.includes("duplicate key value violates unique constraint")) {
        setError(`Group ${row.group_no} already exists. Use Edit to update.`);
      } else {
        setError(msg || "Could not save group.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEditProject = async (row) => {
    if (!activeSemesterId) return;
    setMessage("");
    setError("");
    setLoading(true);
    try {
      const res = await adminUpsertProject({ ...row, semesterId: activeSemesterId }, adminPass);
      applyProjectPatch({
        id: res?.project_id || res?.projectId || undefined,
        semester_id: activeSemesterId,
        group_no: row.group_no,
        project_title: row.project_title,
        group_students: row.group_students,
      });
      setMessage("Group updated.");
    } catch (e) {
      setError(e?.message || "Could not update group.");
    } finally {
      setLoading(false);
    }
  };


  const handleAddJuror = async (row) => {
    setMessage("");
    setError("");
    setLoading(true);
    try {
      const created = await adminCreateJuror(row, adminPass);
      if (created?.juror_id) {
        applyJurorPatch({
          juror_id: created.juror_id,
          juror_name: created.juror_name,
          juror_inst: created.juror_inst,
          locked_until: null,
          last_seen_at: null,
          is_locked: false,
          is_assigned: false,
          scored_semesters: [],
          edit_enabled: false,
          final_submitted_at: null,
          last_activity_at: null,
          total_projects: projects.length,
          completed_projects: 0,
        });
      }
      setMessage("Juror added.");
    } catch (e) {
      const msg = String(e?.message || "");
      const msgLower = msg.toLowerCase();
      if (msg.includes("juror_exists")
        || msgLower.includes("jurors_name_inst_norm_uniq")
        || msgLower.includes("duplicate key value violates unique constraint")) {
        setError("Juror already exists.");
      } else {
        setError(msg || "Could not add juror.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleImportJurors = async (rows) => {
    setMessage("");
    setError("");
    setLoading(true);
    try {
      let skipped = 0;
      for (const row of rows) {
        try {
          const created = await adminCreateJuror(row, adminPass);
          if (created?.juror_id) {
            applyJurorPatch({
              juror_id: created.juror_id,
              juror_name: created.juror_name,
              juror_inst: created.juror_inst,
              locked_until: null,
              last_seen_at: null,
              is_locked: false,
              is_assigned: false,
              scored_semesters: [],
              edit_enabled: false,
              final_submitted_at: null,
              last_activity_at: null,
              total_projects: projects.length,
              completed_projects: 0,
            });
          }
        } catch (e) {
          const msg = String(e?.message || "");
          const msgLower = msg.toLowerCase();
          if (msg.includes("juror_exists")
            || msgLower.includes("jurors_name_inst_norm_uniq")
            || msgLower.includes("duplicate key value violates unique constraint")) {
            skipped += 1;
            continue;
          }
          throw e;
        }
      }
      setMessage(
        skipped > 0
          ? `Jurors imported. Skipped ${skipped} existing jurors.`
          : "Jurors imported."
      );
      return { skipped };
    } catch (e) {
      const msg = String(e?.message || "");
      const msgLower = msg.toLowerCase();
      if (msg.includes("juror_exists")
        || msgLower.includes("jurors_name_inst_norm_uniq")
        || msgLower.includes("duplicate key value violates unique constraint")) {
        setError("Some jurors already exist. Refresh and try again.");
      } else {
        setError(msg || "Could not import jurors.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEditJuror = async (row) => {
    if (!row?.jurorId) return;
    setMessage("");
    setError("");
    setLoading(true);
    try {
      await adminUpdateJuror(row, adminPass);
      applyJurorPatch({
        juror_id: row.jurorId,
        juror_name: row.juror_name,
        juror_inst: row.juror_inst,
      });
      setMessage("Juror updated.");
    } catch (e) {
      setError(e?.message || "Could not update juror.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPin = async (juror) => {
    const jurorId = juror?.jurorId || juror?.juror_id;
    const jurorName = juror?.juror_name || juror?.juryName;
    const jurorInst = juror?.juror_inst || juror?.juryDept;
    if (!activeSemesterId || !jurorId) return;
    setMessage("");
    setError("");
    setLoading(true);
    try {
      const res = await adminResetJurorPin({ semesterId: activeSemesterId, jurorId }, adminPass);
      setResetPinInfo({
        ...res,
        juror_name: jurorName || res?.juror_name || null,
        juror_inst: jurorInst || res?.juror_inst || null,
      });
      applyJurorPatch({
        juror_id: jurorId,
        locked_until: null,
        failed_attempts: 0,
        is_locked: false,
        last_seen_at: null,
      });
      setMessage("PIN reset.");
    } catch (e) {
      setError(e?.message || "Could not reset PIN.");
    } finally {
      setLoading(false);
    }
  };

  const handleToggleJurorEdit = async ({ jurorId, enabled }) => {
    if (!activeSemesterId || !jurorId) return;
    setMessage("");
    setError("");
    // Optimistic update — revert below if the RPC fails
    applyJurorPatch({ juror_id: jurorId, edit_enabled: !!enabled });
    setLoading(true);
    try {
      await adminSetJurorEditMode(
        { semesterId: activeSemesterId, jurorId, enabled },
        adminPass
      );
      setMessage(enabled ? "Edit mode enabled." : "Edit mode disabled.");
    } catch (e) {
      applyJurorPatch({ juror_id: jurorId, edit_enabled: !enabled }); // revert
      const msg = String(e?.message || "");
      if (msg.includes("final_submit_required")) {
        setError("Cannot disable edit mode until all scores are re-submitted.");
      } else if (msg.includes("no_pin")) {
        setError("Juror PIN is missing for this semester. Reset the PIN first.");
      } else if (msg.includes("semester_inactive")) {
        setError("Only the active semester can be edited.");
      } else if (msg.includes("unauthorized")) {
        setError("Admin password is invalid. Please re-login.");
      } else {
        setError(e?.message || "Could not update edit mode.");
      }
    } finally {
      setLoading(false);
    }
  };


  const handleSaveSettings = async (next) => {
    if (!adminPass) return;
    setLoading(true);
    setMessage("");
    setError("");
    try {
      await adminSetSetting(SETTINGS_KEYS.evalLock, String(!!next.evalLockActive), adminPass);
      setSettings(next);
      setMessage("Settings saved.");
    } catch (e) {
      setError(e?.message || "Could not save settings.");
    } finally {
      setLoading(false);
    }
  };

  const handleAuditRefresh = () => {
    loadAuditLogs(auditFilters);
  };

  const handleAuditReset = () => {
    setAuditFilters(defaultAuditFilters);
    setAuditSearch("");
  };

  const handleRequestDelete = async (target) => {
    if (!target || !target.id) return;
    setDeleteTarget(target);
    setDeleteCounts(null);
    if (!adminPass) return;
    try {
      const counts = await adminDeleteCounts(target.type, target.id, adminPass);
      setDeleteCounts(counts);
    } catch (_) { /* counts are optional */ }
  };

  const mapDeleteError = (e) => {
    const msg = String(e?.message || "");
    if (msg.includes("delete_password_missing")) {
      return "Delete password is not configured. Set it in Admin Security.";
    }
    if (msg.includes("incorrect_delete_password") || msg.includes("unauthorized")) {
      return "Incorrect delete password.";
    }
    if (msg.includes("not_found")) {
      return "Item not found.";
    }
    return "Could not delete. Please try again.";
  };

  const handleConfirmDelete = async (password) => {
    if (!deleteTarget) throw new Error("Nothing selected for deletion.");
    const { type, id, label } = deleteTarget;
    setMessage("");
    setError("");
    await adminDeleteEntity({ targetType: type, targetId: id, deletePassword: password });
    if (type === "semester") {
      setSemesterList((prev) => {
        const remaining = prev.filter((s) => s.id !== id);
        if (activeSemesterId === id) {
          setActiveSemesterId(remaining[0]?.id || "");
        }
        return remaining;
      });
    } else if (type === "project") {
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } else if (type === "juror") {
      setJurors((prev) => prev.filter((j) => (j.juror_id || j.jurorId) !== id));
    }
    setMessage(`Deleted ${label}.`);
  };

  const handleDbExportStart = () => {
    setDbBackupMode("export");
    setDbBackupPassword("");
    setDbBackupError("");
    setDbImportData(null);
  };

  const handleDbImportFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target.result);
        setDbImportData(parsed);
        setDbBackupMode("import");
        setDbBackupPassword("");
        setDbBackupError("");
      } catch {
        setDbBackupError("Invalid backup file. Could not parse JSON.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const mapDbBackupError = (e) => {
    const msg = String(e?.message || "");
    if (msg.includes("backup_password_missing")) return "Backup password is not configured. Set it in Admin Security.";
    if (msg.includes("incorrect_backup_password")) return "Incorrect backup password.";
    if (msg.includes("unauthorized")) return "Incorrect admin password.";
    return null;
  };

  const handleDbExportConfirm = async () => {
    if (!dbBackupPassword || !adminPass) return;
    setDbBackupLoading(true);
    setDbBackupError("");
    try {
      const data = await adminFullExport(dbBackupPassword, adminPass);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = buildExportFilename("backup", activeSemester?.name, "json");
      a.click();
      URL.revokeObjectURL(url);
      setDbBackupMode(null);
      setDbBackupPassword("");
      setMessage("Backup downloaded successfully.");
    } catch (e) {
      setDbBackupError(mapDbBackupError(e) || "Export failed. Please try again.");
    } finally {
      setDbBackupLoading(false);
    }
  };

  const handleDbImportConfirm = async () => {
    if (!dbImportData || !dbBackupPassword || !adminPass) return;
    setDbBackupLoading(true);
    setDbBackupError("");
    try {
      await adminFullImport(dbImportData, dbBackupPassword, adminPass);
      setDbBackupMode(null);
      setDbBackupPassword("");
      setDbImportData(null);
      setMessage("Database restored successfully.");
    } catch (e) {
      setDbBackupError(mapDbBackupError(e) || "Import failed. Please try again.");
    } finally {
      setDbBackupLoading(false);
    }
  };

  const handleExportProjects = async () => {
    if (!projects.length) return;
    const XLSX = await import("xlsx");
    const headers = ["group_no", "project_title", "group_students"];
    const data = projects.map((p) => [p.group_no, p.project_title, p.group_students || ""]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = [8, 36, 42].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Projects");
    XLSX.writeFile(wb, buildExportFilename("projects", activeSemester?.name));
  };

  const handleExportJurors = async () => {
    if (!jurors.length) return;
    const XLSX = await import("xlsx");
    const headers = ["juror_name", "juror_inst"];
    const data = jurors.map((j) => [j.juryName || j.juror_name || j.jurorName, j.juryDept || j.juror_inst || j.jurorInst]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = [28, 32].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Jurors");
    XLSX.writeFile(wb, buildExportFilename("jurors", activeSemester?.name));
  };

  const handleExportScores = async () => {
    if (!activeSemesterId || !adminPass) return;
    const rows = await adminGetScores(activeSemesterId, adminPass);
    await exportXLSX(rows || [], {
      semesterName: activeSemester?.name || "",
      summaryData: (projects || []).map((p) => ({ id: p.id, students: p.group_students || "" })),
    });
  };

  return (
    <div className="manage-page">
      {(loading || error || message) && (
        <div className="manage-alerts">
          {loading && <span className="manage-alert">Working…</span>}
          {message && <span className="manage-alert success">{message}</span>}
          {error && <span className="manage-alert error">{error}</span>}
        </div>
      )}
      {resetPinInfo?.pin_plain_once && (
        <div className="manage-modal">
          <div className="manage-modal-card">
            <div className="manage-modal-title">New PIN Created</div>
            <div className="manage-modal-body">
              <div className="manage-hint">
                {resetPinInfo.juror_name || resetPinInfo.juror_id}
                {resetPinInfo.juror_inst ? ` — ${resetPinInfo.juror_inst}` : ""}
              </div>
              <div className="manage-pin-code">{resetPinInfo.pin_plain_once}</div>
            </div>
            <div className="manage-modal-actions">
              <button
                className="manage-btn"
                type="button"
                onClick={() => {
                  navigator.clipboard?.writeText(resetPinInfo.pin_plain_once).catch(() => {});
                }}
              >
                Copy PIN
              </button>
              <button
                className="manage-btn primary"
                type="button"
                onClick={() => setResetPinInfo(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      <DeleteConfirmDialog
        open={!!deleteTarget}
        targetLabel={deleteTarget?.label}
        counts={deleteCounts}
        onOpenChange={(open) => {
          if (!open) { setDeleteTarget(null); setDeleteCounts(null); }
        }}
        onConfirm={async (password) => {
          try {
            await handleConfirmDelete(password);
          } catch (e) {
            const msg = mapDeleteError(e);
            setError(msg);
            throw new Error(msg);
          }
        }}
      />

      <div className="manage-grid">
        <section className="manage-section" style={{ gridColumn: "1 / -1" }}>
          <h3 className="manage-section-title">Data</h3>
          <div className="manage-section-grid">
            <ManageSemesterPanel
              semesters={semesterList}
              activeSemesterId={activeSemesterId}
              isMobile={isMobile}
              isOpen={openPanels.semester}
              onToggle={() => togglePanel("semester")}
              onSetActive={handleSetActiveSemester}
              onCreateSemester={handleCreateSemester}
              onUpdateSemester={handleUpdateSemester}
              onDeleteSemester={(s) =>
                handleRequestDelete({
                  type: "semester",
                  id: s?.id,
                  label: `Semester ${s?.name || ""}`.trim(),
                })
              }
            />

            <ManageProjectsPanel
              projects={projects}
              semesterName={activeSemester?.name || ""}
              isMobile={isMobile}
              isOpen={openPanels.projects}
              onToggle={() => togglePanel("projects")}
              onImport={handleImportProjects}
              onAddGroup={handleAddProject}
              onEditGroup={handleEditProject}
              onDeleteProject={(p, groupLabel) =>
                handleRequestDelete({
                  type: "project",
                  id: p?.id,
                  label: `Group ${groupLabel}${p?.project_title ? ` — ${p.project_title}` : ""}`,
                })
              }
            />

            <ManageJurorsPanel
              jurors={jurors}
              isMobile={isMobile}
              isOpen={openPanels.jurors}
              onToggle={() => togglePanel("jurors")}
              onImport={handleImportJurors}
              onAddJuror={handleAddJuror}
              onEditJuror={handleEditJuror}
              onResetPin={handleResetPin}
              onDeleteJuror={(j) =>
                handleRequestDelete({
                  type: "juror",
                  id: j?.jurorId || j?.juror_id,
                  label: `Juror ${j?.juryName || j?.juror_name || ""}`.trim(),
                })
              }
            />

            <ManagePermissionsPanel
              settings={settings}
              jurors={jurors}
              isMobile={isMobile}
              isOpen={openPanels.permissions}
              onToggle={() => togglePanel("permissions")}
              onSave={handleSaveSettings}
              onToggleEdit={handleToggleJurorEdit}
            />
          </div>
        </section>

        <section className="manage-section" style={{ gridColumn: "1 / -1" }}>
          <h3 className="manage-section-title">Access Control</h3>
          <div className="manage-section-grid">
            <AdminSecurityPanel
              isMobile={isMobile}
              isOpen={openPanels.security}
              onToggle={() => togglePanel("security")}
              onPasswordChanged={onAdminPasswordChange}
              adminPass={adminPass}
              innerRef={adminSecurityRef}
            />

            <div
              className={`manage-card manage-card-audit${isMobile ? " is-collapsible" : ""}`}
              ref={auditCardRef}
            >
              <button
                type="button"
                className="manage-card-header"
                onClick={() => togglePanel("audit")}
                aria-expanded={openPanels.audit}
              >
                <div className="manage-card-title">
                  <span className="manage-card-icon" aria-hidden="true"><HistoryIcon /></span>
                  Audit Log
                </div>
                {isMobile && <ChevronDownIcon className={`manage-chevron${openPanels.audit ? " open" : ""}`} />}
              </button>

              {(!isMobile || openPanels.audit) && (
                <div className="manage-card-body manage-audit-body">
                  <div className="manage-audit-header">
                    <div className="manage-card-desc">Latest audit events (most recent first).</div>
                    <div className="manage-audit-filters">
                      <div className="manage-field">
                        <label className="manage-label" htmlFor="auditStartDate">From</label>
                        <input
                          id="auditStartDate"
                          type="datetime-local"
                          step="60"
                          placeholder="YYYY-MM-DDThh:mm"
                          className={`manage-input manage-date${auditFilters.startDate ? "" : " is-empty"}${auditError ? " is-error" : ""}`}
                          value={auditFilters.startDate}
                          onChange={(e) => setAuditFilters((prev) => ({ ...prev, startDate: e.target.value }))}
                        />
                      </div>
                      <div className="manage-field">
                        <label className="manage-label" htmlFor="auditEndDate">To</label>
                        <input
                          id="auditEndDate"
                          type="datetime-local"
                          step="60"
                          placeholder="YYYY-MM-DDThh:mm"
                          className={`manage-input manage-date${auditFilters.endDate ? "" : " is-empty"}${auditError ? " is-error" : ""}`}
                          value={auditFilters.endDate}
                          onChange={(e) => setAuditFilters((prev) => ({ ...prev, endDate: e.target.value }))}
                        />
                      </div>
                      <div className="manage-field">
                        <label className="manage-label" htmlFor="auditSearch">Search</label>
                        <input
                          id="auditSearch"
                          type="text"
                          className="manage-input"
                          placeholder="Search message or entity"
                          value={auditSearch}
                          onChange={(e) => setAuditSearch(e.target.value)}
                        />
                      </div>
                    </div>

                    {auditError && <div className="manage-hint manage-hint-error">{auditError}</div>}
                    {auditLoading && <div className="manage-hint">Loading audit logs…</div>}
                  </div>

                  <div className="manage-audit-scroll" role="region" aria-label="Audit log list">
                    {!auditLoading && visibleAuditLogs.length === 0 && (
                      <div className="manage-empty manage-empty-subtle">No audit entries found.</div>
                    )}

                    {visibleAuditLogs.length > 0 && (
                      <div className="manage-audit-list">
                        {visibleAuditLogs.map((log) => (
                          <div key={log.id} className="manage-audit-row">
                            <span className="manage-audit-time">{formatAuditTimestamp(log.created_at)}</span>
                            <span className="manage-audit-sep" aria-hidden="true">—</span>
                            <span className="manage-audit-message">{log.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className={`manage-card${isMobile ? " is-collapsible" : ""}`}>
              <button
                type="button"
                className="manage-card-header"
                onClick={() => togglePanel("export")}
                aria-expanded={openPanels.export}
              >
                <div className="manage-card-title">
                  <span className="manage-card-icon" aria-hidden="true"><DownloadIcon /></span>
                  Export Tools
                </div>
                {isMobile && <ChevronDownIcon className={`manage-chevron${openPanels.export ? " open" : ""}`} />}
              </button>

              {(!isMobile || openPanels.export) && (
                <div className="manage-card-body">
                  <div className="manage-card-desc">Download Excel exports for scores, jurors, and projects.</div>
                  <div className="manage-export-actions">
                    <button className="manage-btn" type="button" onClick={handleExportScores}>
                      <DownloadIcon /> Export Scores
                    </button>
                    <button className="manage-btn" type="button" onClick={handleExportJurors}>
                      <DownloadIcon /> Export Jurors
                    </button>
                    <button className="manage-btn" type="button" onClick={handleExportProjects}>
                      <DownloadIcon /> Export Projects
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className={`manage-card${isMobile ? " is-collapsible" : ""}`}>
              <button
                type="button"
                className="manage-card-header"
                onClick={() => togglePanel("dbbackup")}
                aria-expanded={openPanels.dbbackup}
              >
                <div className="manage-card-title">
                  <span className="manage-card-icon" aria-hidden="true"><DatabaseIcon /></span>
                  Database Backup
                </div>
                {isMobile && <ChevronDownIcon className={`manage-chevron${openPanels.dbbackup ? " open" : ""}`} />}
              </button>

              {(!isMobile || openPanels.dbbackup) && (
                <div className="manage-card-body">
                  <div className="manage-card-desc">
                    Export or restore the full database. Requires backup password set in Admin Security.
                  </div>

                  <input
                    ref={importFileRef}
                    type="file"
                    accept=".json"
                    style={{ display: "none" }}
                    onChange={handleDbImportFileSelect}
                  />

                  {!dbBackupMode && (
                    <div className="manage-export-actions">
                      <button className="manage-btn" type="button" onClick={handleDbExportStart}>
                        <DownloadIcon /> Export Database
                      </button>
                      <button className="manage-btn" type="button" onClick={() => importFileRef.current?.click()}>
                        <UploadIcon /> Import / Restore
                      </button>
                    </div>
                  )}

                  {dbBackupMode && (
                    <div className="manage-security-stack" style={{ marginTop: "0.75rem" }}>
                      <div className="manage-mini-card">
                        <div className="manage-mini-card-title">
                          {dbBackupMode === "export" ? "Confirm Export" : "Confirm Restore"}
                        </div>
                        <div className="manage-mini-card-body">
                          {dbBackupMode === "import" && (
                            <div className="manage-hint" style={{ marginBottom: "0.5rem" }}>
                              This will overwrite existing data with the backup. This action cannot be undone.
                            </div>
                          )}
                          <div className="manage-field">
                            <label className="manage-label">Backup Password</label>
                            <input
                              type="password"
                              className="manage-input"
                              value={dbBackupPassword}
                              onChange={(e) => { setDbBackupPassword(e.target.value); setDbBackupError(""); }}
                              disabled={dbBackupLoading}
                              autoFocus
                            />
                          </div>
                          {dbBackupError && (
                            <div className="manage-alerts">
                              <span className="manage-alert error">{dbBackupError}</span>
                            </div>
                          )}
                          <div className="manage-card-actions">
                            <button
                              className="manage-btn"
                              type="button"
                              disabled={dbBackupLoading}
                              onClick={() => { setDbBackupMode(null); setDbBackupPassword(""); setDbImportData(null); }}
                            >
                              Cancel
                            </button>
                            <button
                              className="manage-btn primary"
                              type="button"
                              disabled={dbBackupLoading || !dbBackupPassword}
                              onClick={dbBackupMode === "export" ? handleDbExportConfirm : handleDbImportConfirm}
                            >
                              {dbBackupLoading
                                ? (dbBackupMode === "export" ? "Exporting…" : "Restoring…")
                                : (dbBackupMode === "export" ? "Download Backup" : "Restore Database")}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
