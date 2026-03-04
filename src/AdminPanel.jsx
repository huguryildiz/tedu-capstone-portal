// src/AdminPanel.jsx
// ============================================================
// Admin results dashboard with five tabs.
//
// Data source: Supabase RPCs via src/shared/api.js
//   - adminGetScores       → raw score rows (for Jurors/Matrix/Details tabs)
//   - adminProjectSummary  → per-project aggregates + notes (for Summary/Dashboard tabs)
//
// Field names in rawScores are normalized in api.js to match
// the old GAS row shape so existing tab components work as-is.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
import { CRITERIA } from "./config";
import {
  adminLogin,
  adminGetScores,
  adminListJurors,
  adminProjectSummary,
  listSemesters,
} from "./shared/api";
import { toNum, tsToMillis, cmp, jurorBg, jurorDot, rowKey } from "./admin/utils";
import { readSection, writeSection } from "./admin/persist";
import { HomeIcon, RefreshIcon } from "./admin/components";
import {
  UserRoundCheckIcon,
  HourglassIcon,
  PencilIcon,
  CheckCircle2Icon,
  ListChecksIcon,
  TrophyIcon,
  ChartIcon,
  LayoutDashboardIcon,
  ClockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  SettingsIcon,
} from "./shared/Icons";
import OverviewTab    from "./admin/OverviewTab";
import ResultsTab     from "./admin/ResultsTab";
import AnalysisTab    from "./admin/AnalysisTab";
import ManagePage     from "./admin/ManagePage";
import "./styles/admin-layout.css";
import "./styles/admin-summary.css";
import "./styles/admin-details.css";
import "./styles/admin-jurors.css";
import "./styles/admin-matrix.css";
import "./styles/admin-dashboard.css";
import "./styles/admin-responsive.css";
import "./styles/admin-manage.css";

const CRITERIA_LIST = CRITERIA.map((c) => ({
  id: c.id, label: c.label, shortLabel: c.shortLabel, max: c.max,
}));

const TABS = [
  { id: "overview",  label: "Overview",  icon: LayoutDashboardIcon },
  { id: "results",   label: "Results",   icon: TrophyIcon    },
  { id: "analysis",  label: "Analysis",  icon: ChartIcon     },
  { id: "manage",    label: "Manage",    icon: SettingsIcon  },
];

function SemesterDropdown({
  semesterList,
  sortedSemesters,
  selectedSemesterId,
  selectedSemesterName,
  semesterOpen,
  setSemesterOpen,
  setSelectedSemesterId,
  fetchData,
  semesterRef,
}) {
  if (semesterList.length === 0) return null;

  return (
    <div className="semester-dropdown" ref={semesterRef}>
      <button
        type="button"
        className={`status-chip status-chip--semester semester-dropdown-trigger${semesterOpen ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={semesterOpen}
        onClick={() => setSemesterOpen((v) => !v)}
      >
        <span className="semester-dropdown-label">{selectedSemesterName}</span>
        <span className="semester-dropdown-chevron" aria-hidden="true"><ChevronDownIcon /></span>
      </button>
      {semesterOpen && (
        <ul
          className="semester-dropdown-panel"
          role="listbox"
          aria-label="Select semester"
        >
          {sortedSemesters.map((s) => (
            <li
              key={s.id}
              role="option"
              aria-selected={selectedSemesterId === s.id}
              className={`semester-dropdown-item${selectedSemesterId === s.id ? " active" : ""}`}
              onClick={() => {
                setSelectedSemesterId(s.id);
                setSemesterOpen(false);
                fetchData(s.id);
              }}
            >
              {s.name}
              {selectedSemesterId === s.id && (
                <span className="semester-dropdown-check" aria-hidden="true">✓</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultsStatusBar({ metrics, id, semesterSlot }) {
  const {
    completedJurors, totalJurors,
    completedEvaluations, totalEvaluations,
    inProgressJurors, editingJurors,
  } = metrics;
  const safeTJ  = Math.max(0, totalJurors || 0);
  const safeCJ  = Math.min(Math.max(0, completedJurors || 0), safeTJ);
  const safeIP  = Math.max(0, inProgressJurors || 0);
  const safeED  = Math.max(0, editingJurors || 0);
  const safeTE  = Math.max(0, totalEvaluations || 0);
  const safeCE  = Math.min(Math.max(0, completedEvaluations || 0), safeTE);
  const isEmpty = safeTJ === 0 && safeCJ === 0 && safeIP === 0 && safeED === 0;
  const jurorTheme = isEmpty ? "empty" : (safeIP === 0 && safeED === 0 ? "completed" : "inprogress");
  const evalTheme  = safeTE === 0 ? "empty" : (safeCE === safeTE ? "completed" : "inprogress");
  const jv = (v) => isEmpty ? "—" : v;
  const ev = safeTE === 0 ? "—" : `${safeCE}/${safeTE}`;

  return (
    <div id={id} className="results-status-bar" role="group" aria-label="Results status metrics">
      {semesterSlot && (
        <div className="results-status-row results-status-row--semester">
          {semesterSlot}
        </div>
      )}
      <div className="results-status-row results-status-row--chips">
        <span className={`status-chip status-chip--${jurorTheme}`}>
          <span className="status-block"><UserRoundCheckIcon /><span className="status-value">{jv(safeTJ)}</span></span>
          <span className="status-sep" aria-hidden="true">·</span>
          <span className="status-block"><CheckCircle2Icon /><span className="status-value">{jv(safeCJ)}</span></span>
          <span className="status-sep" aria-hidden="true">·</span>
          <span className="status-block"><HourglassIcon /><span className="status-value">{jv(safeIP)}</span></span>
          <span className="status-sep" aria-hidden="true">·</span>
          <span className="status-block"><PencilIcon /><span className="status-value">{jv(safeED)}</span></span>
        </span>
        <span className={`status-chip status-chip--${evalTheme}`}>
          <span className="status-block"><ListChecksIcon /><span className="status-value">{ev}</span></span>
        </span>
      </div>
    </div>
  );
}

export default function AdminPanel({ adminPass, onBack, onAuthError, onInitialLoadDone }) {
  // Raw score rows — normalized by api.js to match old GAS field names
  const [rawScores,  setRawScores]  = useState([]);
  // All jurors for semester (includes those with zero scores)
  const [allJurors,  setAllJurors]  = useState([]);
  // Per-project aggregates from rpc_admin_project_summary
  const [summaryData, setSummaryData] = useState([]);
  // Semester selector
  const [semesterList,       setSemesterList]       = useState([]);
  const [selectedSemesterId, setSelectedSemesterId] = useState("");
  const [semesterOpen,       setSemesterOpen]       = useState(false);
  const semesterRef = useRef(null);

  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState("");
  const [authError,   setAuthError]   = useState("");
  const [showStatus,  setShowStatus]  = useState(true);
  const VALID_TABS = new Set(["overview", "results", "analysis", "manage"]);
  const [activeTab,   setActiveTab]   = useState(() => {
    const saved = readSection("tab").activeTab;
    return VALID_TABS.has(saved) ? saved : "overview";
  });
  const [lastRefresh, setLastRefresh] = useState(null);
  const [tabOverflow, setTabOverflow] = useState(false);
  const [tabHintLeft, setTabHintLeft] = useState(false);
  const [tabHintRight, setTabHintRight] = useState(false);
  const tabBarRef = useRef(null);

  const initialLoadFiredRef = useRef(false);
  const [adminPassState, setAdminPassState] = useState(
    () => adminPass || sessionStorage.getItem("ee492_admin_pass") || ""
  );
  const passRef = useRef(adminPassState);
  useEffect(() => {
    const next = adminPass || sessionStorage.getItem("ee492_admin_pass") || "";
    setAdminPassState(next);
  }, [adminPass]);
  useEffect(() => { passRef.current = adminPassState; }, [adminPassState]);
  const getAdminPass = () => passRef.current || sessionStorage.getItem("ee492_admin_pass") || "";
  const handleAdminPasswordChange = (nextPass) => {
    if (!nextPass) return;
    setAdminPassState(nextPass);
    passRef.current = nextPass;
    try { sessionStorage.setItem("ee492_admin_pass", nextPass); } catch {}
  };

  // Track selected semester separately so refresh uses the latest selection
  const selectedSemesterRef = useRef("");
  useEffect(() => { selectedSemesterRef.current = selectedSemesterId; }, [selectedSemesterId]);

  // Close semester dropdown on outside click
  useEffect(() => {
    if (!semesterOpen) return;
    function handleOutside(e) {
      if (semesterRef.current && !semesterRef.current.contains(e.target)) {
        setSemesterOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [semesterOpen]);

  // ── Data fetch ────────────────────────────────────────────
  const fetchData = async (forceSemesterId) => {
    setLoading(true);
    setError("");
    try {
      const pass = getAdminPass();
      if (!pass) {
        setRawScores([]);
        setSummaryData([]);
        setAuthError("Enter the admin password to load results.");
        return;
      }

      // Verify credentials first
      const valid = await adminLogin(pass);
      if (!valid) {
        setRawScores([]);
        setSummaryData([]);
        if (onAuthError) { onAuthError("Invalid password"); return; }
        setAuthError("Incorrect password.");
        return;
      }

      // Cache password for the duration of this session
      try { sessionStorage.setItem("ee492_admin_pass", pass); } catch {}

      // Always refresh semesters (IDs change after reseed)
      const sems = await listSemesters();
      setSemesterList(sems);

      // Determine target semester
      const targetId =
        forceSemesterId ||
        selectedSemesterRef.current ||
        sems.find((s) => s.is_active)?.id ||
        sems[0]?.id;

      if (!targetId) {
        setRawScores([]);
        setSummaryData([]);
        setLoading(false);
        return;
      }
      setSelectedSemesterId(targetId);

      // Fetch scores + summary + juror list in parallel
      // adminListJurors is non-fatal: degrades gracefully if RPC not yet deployed
      const [scores, summary, jurors] = await Promise.all([
        adminGetScores(targetId, pass),
        adminProjectSummary(targetId, pass),
        adminListJurors(targetId, pass).catch(() => []),
      ]);

      setRawScores(scores);
      setSummaryData(summary);
      setAllJurors(jurors);
      setLastRefresh(new Date());
      setAuthError("");

      if (!initialLoadFiredRef.current) {
        initialLoadFiredRef.current = true;
        onInitialLoadDone?.();
      }
    } catch (e) {
      if (e.unauthorized) {
        if (onAuthError) { onAuthError("Invalid password"); return; }
        setAuthError("Incorrect password.");
        return;
      }
      if (onAuthError) { onAuthError("Connection error — try again."); return; }
      setError("Could not load data: " + e.message);
      setRawScores([]);
      setSummaryData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Tab overflow hints ─────────────────────────────────────
  const updateTabHints = () => {
    const el = tabBarRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const hasOverflow = maxScroll > 2;
    setTabOverflow(hasOverflow);
    if (!hasOverflow) { setTabHintLeft(false); setTabHintRight(false); return; }
    setTabHintLeft(el.scrollLeft > 4);
    setTabHintRight(el.scrollLeft < maxScroll - 4);
  };
  useEffect(() => {
    updateTabHints();
    window.addEventListener("resize", updateTabHints);
    return () => window.removeEventListener("resize", updateTabHints);
  }, [activeTab, showStatus]);

  // ── Derived data ───────────────────────────────────────────
  // Total projects in this semester (dynamic)
  const totalProjects = summaryData.length;

  // Groups for MatrixTab/JurorsTab (built from summaryData so UUIDs are correct)
  const groups = useMemo(
    () =>
      summaryData
        .map((p) => ({
          id: p.id,
          groupNo: p.groupNo,
          label: `Group ${p.groupNo}`,
          title: p.name ?? "",
          students: p.students ?? "",
          desc: "",
        }))
        .sort((a, b) => a.groupNo - b.groupNo),
    [summaryData]
  );

  // Unique jurors — seeded from allJurors (full list) so unscored jurors appear too
  const uniqueJurors = useMemo(() => {
    const seen = new Map();
    // Seed from allJurors first (includes jurors with 0 scores)
    allJurors.forEach((j) => {
      const key = j.jurorId;
      if (!seen.has(key)) {
        seen.set(key, {
          key,
          name: j.juryName.trim(),
          dept: j.juryDept.trim(),
          jurorId: j.jurorId,
          editEnabled: !!j.editEnabled,
          isAssigned: j.isAssigned,
        });
      }
    });
    // Fill / override with rawScores data (has same info, just ensures consistency)
    rawScores.forEach((d) => {
      if (!d.juryName) return;
      const key = d.jurorId || rowKey(d);
      const prev = seen.get(key);
      seen.set(key, {
        key,
        name: d.juryName.trim(),
        dept: d.juryDept.trim(),
        jurorId: d.jurorId,
        editEnabled: prev?.editEnabled ?? false,
        isAssigned: prev?.isAssigned,
      });
    });
    return [...seen.values()].sort((a, b) => cmp(a.name, b.name));
  }, [allJurors, rawScores]);

  // Matrix should show only jurors assigned to the selected semester.
  const matrixJurors = useMemo(() => {
    const assignedMap = new Map(allJurors.map((j) => [j.jurorId, j.isAssigned]));
    const hasAssignedFlag = allJurors.some((j) => typeof j.isAssigned === "boolean");
    if (hasAssignedFlag) {
      return uniqueJurors.filter((j) => assignedMap.get(j.jurorId) === true);
    }
    // Fallback: only jurors that appear in scores
    const scoreKeys = new Set(rawScores.map((r) => rowKey(r)));
    return uniqueJurors.filter((j) => scoreKeys.has(j.key));
  }, [allJurors, uniqueJurors, rawScores]);

  const assignedJurors = matrixJurors;

  const jurorDeptMap = useMemo(() => {
    const m = new Map();
    uniqueJurors.forEach(({ key, dept }) => m.set(key, dept));
    return m;
  }, [uniqueJurors]);

  const jurorColorMap = useMemo(() => {
    const m = new Map();
    uniqueJurors.forEach(({ key, name }) => m.set(key, { bg: jurorBg(name), dot: jurorDot(name) }));
    return m;
  }, [uniqueJurors]);

  // Rows with all criteria filled = "submitted" in Supabase model
  const submittedData = useMemo(
    () => rawScores.filter((r) => r.status === "submitted"),
    [rawScores]
  );
  const dashboardData = useMemo(
    () => rawScores.filter((r) => r.status === "submitted" || r.status === "in_progress"),
    [rawScores]
  );
  const completedData = useMemo(
    () => rawScores.filter((r) => r.status === "submitted" || r.status === "in_progress"),
    [rawScores]
  );

  // For DashboardTab: summaryData as dashboardStats
  // DashboardTab receives the same shape as old projectStats
  const dashboardStats = useMemo(
    () =>
      summaryData.map((p) => ({
        id:       p.id,
        name:     `Group ${p.groupNo}`,
        students: p.students,
        count:    p.count,
        avg:      p.avg,
        totalAvg: p.totalAvg,
        totalMin: p.totalMin,
        totalMax: p.totalMax,
      })),
    [summaryData]
  );

  // For SummaryTab: ranked by totalAvg descending
  const ranked = useMemo(
    () => [...summaryData].sort((a, b) => b.totalAvg - a.totalAvg),
    [summaryData]
  );

  // jurorStats for JurorsTab
  const jurorStats = useMemo(() => {
    return assignedJurors.map(({ key, name, dept, jurorId, editEnabled }) => {
      const rows       = rawScores.filter((d) => rowKey(d) === key);
      const completed  = rows.filter((r) => r.status === "submitted");
      const inProgress = rows.filter((r) => r.status === "in_progress");
      const latestTs   = rows.reduce((mx, r) => (r.tsMs > mx ? r.tsMs : mx), 0);
      const latestRow  = rows.find((r) => r.tsMs === latestTs) || rows[0];

      const overall =
        completed.length >= totalProjects && totalProjects > 0 ? "all_submitted" :
        (completed.length > 0 || inProgress.length > 0)         ? "in_progress"   :
        "not_started";

      return {
        key, jury: name, dept, jurorId, rows,
        submitted: completed,
        completed, finalSubmitted: completed, inProgress,
        latestTs, latestRow, overall,
        editEnabled,
      };
    });
  }, [assignedJurors, rawScores, totalProjects]);

  // statusMetrics for header status bar
  const statusMetrics = useMemo(() => {
    const assignedIds = new Set(assignedJurors.map((j) => j.jurorId));
    const totalJurors = assignedJurors.length;
    const completedEvaluations = submittedData.filter((r) =>
      assignedIds.size === 0 ? true : assignedIds.has(r.jurorId)
    ).length;
    const totalEvaluations = totalJurors * totalProjects;
    const submittedByJuror = new Map();
    rawScores.forEach((r) => {
      if (r.status !== "submitted") return;
      if (assignedIds.size > 0 && !assignedIds.has(r.jurorId)) return;
      const key = rowKey(r);
      if (!submittedByJuror.has(key)) submittedByJuror.set(key, new Set());
      submittedByJuror.get(key).add(r.projectId);
    });
    const completedJurors = assignedJurors.filter(
      (j) => (submittedByJuror.get(j.key)?.size || 0) >= totalProjects && totalProjects > 0
    ).length;
    const inProgressKeys = new Set(
      rawScores
        .filter((r) => r.status === "in_progress")
        .filter((r) => assignedIds.size === 0 ? true : assignedIds.has(r.jurorId))
        .map((r) => rowKey(r))
    );
    const editingJurors = allJurors.filter((j) => {
      const assigned = j.isAssigned ?? j.is_assigned;
      const enabled = j.editEnabled ?? j.edit_enabled;
      return (assignedIds.size === 0 ? true : assigned) && !!enabled;
    }).length;
    return {
      completedJurors,
      totalJurors,
      completedEvaluations,
      totalEvaluations,
      inProgressJurors: inProgressKeys.size,
      editingJurors,
    };
  }, [rawScores, submittedData, assignedJurors, allJurors, totalProjects]);

  useEffect(() => {
    if (!lastRefresh) return;
    try {
      sessionStorage.setItem(
        "ee492_home_meta",
        JSON.stringify({
          totalJurors: statusMetrics.totalJurors,
          completedJurors: statusMetrics.completedJurors,
          lastUpdated: lastRefresh.toISOString(),
        })
      );
    } catch {}
  }, [statusMetrics.totalJurors, statusMetrics.completedJurors, lastRefresh]);

  const lastRefreshTime = lastRefresh
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit", hour12: false,
      }).format(lastRefresh)
    : "";

  // Semester list sorted descending: year DESC, then Spring > Fall within same year
  const sortedSemesters = useMemo(() => {
    const TERM_RANK = { spring: 2, summer: 1, fall: 0, winter: -1 };
    function semKey(name = "") {
      const [y = "0", t = ""] = name.split(" ");
      return parseInt(y, 10) * 10 + (TERM_RANK[t.toLowerCase()] ?? 0);
    }
    return semesterList.slice().sort((a, b) => semKey(b.name) - semKey(a.name));
  }, [semesterList]);
  const selectedSemesterName = sortedSemesters.find((s) => s.id === selectedSemesterId)?.name ?? "Semester";

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="admin-screen">

      {/* Header */}
      <div className="form-header">
        <div className="form-header-main">
          <div className="header-left">
            <button className="back-btn" onClick={onBack} aria-label="Back to home">
              <HomeIcon />
            </button>
            <div className="header-title">
              <div className="results-title-row">
                <h2>Admin Panel</h2>
                <button
                  className="results-toggle"
                  type="button"
                  aria-label={showStatus ? "Hide status metrics" : "Show status metrics"}
                  aria-expanded={showStatus}
                  aria-controls="results-status-bar"
                  onClick={() => setShowStatus((v) => !v)}
                >
                  <span className={`results-toggle-icon${showStatus ? " open" : ""}`} aria-hidden="true">
                    <ChevronDownIcon />
                  </span>
                </button>
              </div>
            </div>
          </div>
          <div className="header-right">
            {lastRefresh && (
              <span className="last-updated">
                <ClockIcon />
                <span className="last-updated-time">{lastRefreshTime}</span>
              </span>
            )}
            <button
              className={`refresh-btn${loading ? " is-loading" : ""}`}
              onClick={() => fetchData()}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshIcon />
            </button>
          </div>
        </div>
        {showStatus && (
          <div className="status-expandable">
            <SemesterDropdown
              semesterList={semesterList}
              sortedSemesters={sortedSemesters}
              selectedSemesterId={selectedSemesterId}
              selectedSemesterName={selectedSemesterName}
              semesterOpen={semesterOpen}
              setSemesterOpen={setSemesterOpen}
              setSelectedSemesterId={setSelectedSemesterId}
              fetchData={fetchData}
              semesterRef={semesterRef}
            />
            <ResultsStatusBar
              id="results-status-bar"
              metrics={statusMetrics}
            />
          </div>
        )}

        {/* Tab bar */}
        <div className="tab-bar-wrap">
          <div className="tab-bar" ref={tabBarRef} onScroll={updateTabHints}>
            {TABS.map((t) => (
              <button
                key={t.id}
                className={`tab ${activeTab === t.id ? "active" : ""}`}
                onClick={() => { setActiveTab(t.id); writeSection("tab", { activeTab: t.id }); }}
              >
                <t.icon />
                {t.label}
              </button>
            ))}
          </div>
          {tabOverflow && (
            <div className="tab-hints" aria-hidden="true">
              <span className={`tab-fade left${tabHintLeft ? "" : " is-hidden"}`} />
              <span className={`tab-fade right${tabHintRight ? "" : " is-hidden"}`} />
              <span className={`tab-hint left${tabHintLeft ? "" : " is-hidden"}`}><ChevronLeftIcon /></span>
              <span className={`tab-hint right${tabHintRight ? "" : " is-hidden"}`}><ChevronRightIcon /></span>
            </div>
          )}
        </div>
      </div>

      {/* Status messages */}
      {loading   && <div className="loading">Loading data…</div>}
      {error     && <div className="error-msg">{error}</div>}
      {authError && <div className="error-msg">{authError}</div>}

      {/* Tab content */}
      {!loading && !error && !authError && (
        <div className="admin-body">
          {activeTab === "overview" && (
            <OverviewTab
              jurorStats={jurorStats}
              groups={groups}
            />
          )}
          {activeTab === "results" && (
            <ResultsTab
              ranked={ranked}
              submittedData={submittedData}
              rawScores={rawScores}
              jurors={uniqueJurors}
              matrixJurors={matrixJurors}
              jurorColorMap={jurorColorMap}
              groups={groups}
              semesterName={selectedSemesterName}
              summaryData={summaryData}
              jurorDeptMap={jurorDeptMap}
            />
          )}
          {activeTab === "analysis" && (
            <AnalysisTab
              dashboardStats={dashboardStats}
              submittedData={dashboardData}
              lastRefresh={lastRefresh}
              loading={loading}
              error={error}
              semesterName={selectedSemesterName}
            />
          )}
          {activeTab === "manage" && (
            <ManagePage
              adminPass={adminPassState || getAdminPass()}
              onAdminPasswordChange={handleAdminPasswordChange}
            />
          )}
        </div>
      )}
    </div>
  );
}
