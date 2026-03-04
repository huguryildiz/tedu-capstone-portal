// src/admin/ManagePage.jsx
// ============================================================
// Admin Manage page: semesters, projects, jurors, permissions.
// ============================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  listSemesters,
  adminListJurors,
  adminGetScores,
  adminSetActiveSemester,
  adminCreateSemester,
  adminUpdateSemester,
  adminListProjects,
  adminUpsertProject,
  adminCreateJuror,
  adminUpdateJuror,
  adminResetJurorPin,
  adminSetJurorEditMode,
  adminGetSettings,
  adminSetSetting,
} from "../shared/api";
import { ChevronDownIcon, DownloadIcon } from "../shared/Icons";
import { exportXLSX } from "./utils";
import ManageSemesterPanel from "./ManageSemesterPanel";
import ManageProjectsPanel from "./ManageProjectsPanel";
import ManageJurorsPanel from "./ManageJurorsPanel";
import ManagePermissionsPanel from "./ManagePermissionsPanel";
import AdminSecurityPanel from "../components/admin/AdminSecurityPanel";

const SETTINGS_KEYS = {
  evalLock: "eval_lock_active_semester",
};

const buildExportFilename = (label, semesterName) => {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = String(now.getFullYear());
  const hh = String(now.getHours()).padStart(2, "0");
  const min = String(now.getMinutes()).padStart(2, "0");
  const safeSemester = String(semesterName || "Semester")
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_-]/g, "");
  return `TEDU_EE491-492_Jury_${label}_${safeSemester}_${dd}${mm}${yyyy}_${hh}${min}.xlsx`;
};

const defaultSettings = {
  evalLockActive: false,
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
    export: true,
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

  const handleSetActiveSemester = async (semesterId) => {
    setMessage("");
    setError("");
    if (!adminPass) return setError("Admin password missing.");
    setLoading(true);
    try {
      await adminSetActiveSemester(semesterId, adminPass);
      await loadSemesters();
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
      await adminCreateSemester(payload, adminPass);
      await loadSemesters();
      setMessage("Semester created.");
    } catch (e) {
      setError(e?.message || "Could not create semester.");
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
      await loadSemesters();
      setMessage("Semester updated.");
    } catch (e) {
      setError(e?.message || "Could not update semester.");
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
      for (const row of rows) {
        await adminUpsertProject({ ...row, semesterId: activeSemesterId }, adminPass);
      }
      await loadProjects(activeSemesterId);
      setMessage("Projects imported.");
    } catch (e) {
      setError(e?.message || "Could not import projects.");
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
      await adminUpsertProject({ ...row, semesterId: activeSemesterId }, adminPass);
      await loadProjects(activeSemesterId);
      setMessage("Group saved.");
    } catch (e) {
      setError(e?.message || "Could not save group.");
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
      await adminUpsertProject({ ...row, semesterId: activeSemesterId }, adminPass);
      await loadProjects(activeSemesterId);
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
      await adminCreateJuror(row, adminPass);
      await loadJurors();
      setMessage("Juror added.");
    } catch (e) {
      setError(e?.message || "Could not add juror.");
    } finally {
      setLoading(false);
    }
  };

  const handleImportJurors = async (rows) => {
    setMessage("");
    setError("");
    setLoading(true);
    try {
      for (const row of rows) {
        await adminCreateJuror(row, adminPass);
      }
      await loadJurors();
      setMessage("Jurors imported.");
    } catch (e) {
      setError(e?.message || "Could not import jurors.");
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
      await loadJurors();
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
    setLoading(true);
    try {
      await adminSetJurorEditMode(
        {
          semesterId: activeSemesterId,
          jurorId,
          enabled,
        },
        adminPass
      );
      await loadJurors();
      setMessage(enabled ? "Edit mode enabled." : "Edit mode disabled.");
    } catch (e) {
      setError(e?.message || "Could not update edit mode.");
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

  const handleExportProjects = async () => {
    if (!projects.length) return;
    const XLSX = await import("xlsx");
    const headers = ["group_no", "project_title", "group_students"];
    const data = projects.map((p) => [p.group_no, p.project_title, p.group_students || ""]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    ws["!cols"] = [8, 36, 42].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Projects");
    XLSX.writeFile(wb, buildExportFilename("Projects", activeSemester?.name));
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
    XLSX.writeFile(wb, buildExportFilename("Jurors", activeSemester?.name));
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
            />
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
          </div>
        </section>
      </div>
    </div>
  );
}
