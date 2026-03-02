// src/AdminPanel.jsx
// ============================================================
// Admin results dashboard with five tabs.
//
// Changes in this version:
//   - Parses EditingFlag (column 13) so JurorsTab can show the
//     "Editing" badge when a juror is actively re-editing.
//   - PIN reset button per juror (admin password required).
//   - Juror deduplication is case-insensitive so "Ali" and "ALI"
//     don't appear as two separate jurors.
//   - Admin password stored in a ref, never in state.
// ============================================================

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { PROJECT_LIST, TOTAL_GROUPS, CRITERIA } from "./config";
import { getFromSheet, allowJurorEdit } from "./shared/api";
import { toNum, tsToMillis, cmp, jurorBg, jurorDot, dedupeAndSort, rowKey } from "./admin/utils";
import { readSection, writeSection } from "./admin/persist";
import { HomeIcon, RefreshIcon } from "./admin/components";
import {
  UsersLucideIcon,
  HourglassIcon,
  PencilIcon,
  CheckCircle2Icon,
  ListChecksIcon,
  TrophyIcon,
  ChartIcon,
  ClipboardIcon,
  UserCheckIcon,
  GridIcon,
  ClockIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
} from "./shared/Icons";
import SummaryTab    from "./admin/SummaryTab";
import DashboardTab  from "./admin/DashboardTab";
import DetailsTab    from "./admin/DetailsTab";
import JurorsTab     from "./admin/JurorsTab";
import MatrixTab     from "./admin/MatrixTab";
import "./styles/admin-layout.css";
import "./styles/admin-summary.css";
import "./styles/admin-details.css";
import "./styles/admin-jurors.css";
import "./styles/admin-matrix.css";
import "./styles/admin-dashboard.css";
import "./styles/admin-responsive.css";

// ── Constants ─────────────────────────────────────────────────
const CRITERIA_LIST = CRITERIA.map((c) => ({
  id: c.id, label: c.label, shortLabel: c.shortLabel, max: c.max,
}));

function toNumOrEmpty(v) {
  if (v === "" || v === null || v === undefined) return "";
  if (typeof v === "string" && v.trim() === "") return "";
  const n = Number(
    String(v ?? "").trim().replace(/^"+|"+$/g, "").replace(",", ".")
  );
  return Number.isFinite(n) ? n : "";
}

const TABS = [
  { id: "summary",   label: "Summary",   icon: TrophyIcon  },
  { id: "dashboard", label: "Dashboard", icon: ChartIcon   },
  { id: "detail",    label: "Details",   icon: ClipboardIcon },
  { id: "jurors",    label: "Jurors",    icon: UserCheckIcon    },
  { id: "matrix",    label: "Matrix",    icon: GridIcon    },
];

function ResultsStatusBar({ metrics, id }) {
  const {
    completedJurors,
    totalJurors,
    completedEvaluations,
    totalEvaluations,
    inProgressJurors,
    editingJurors,
  } = metrics;
  const safeTotalJurors = Number.isFinite(totalJurors) ? Math.max(0, totalJurors) : 0;
  const safeCompletedJurors = Number.isFinite(completedJurors)
    ? Math.min(Math.max(0, completedJurors), safeTotalJurors)
    : 0;
  const safeInProgressJurors = Number.isFinite(inProgressJurors) ? Math.max(0, inProgressJurors) : 0;
  const safeEditingJurors = Number.isFinite(editingJurors) ? Math.max(0, editingJurors) : 0;
  const safeTotalEvaluations = Number.isFinite(totalEvaluations) ? Math.max(0, totalEvaluations) : 0;
  const safeCompletedEvaluations = Number.isFinite(completedEvaluations)
    ? Math.min(Math.max(0, completedEvaluations), safeTotalEvaluations)
    : 0;
  const isEmpty =
    safeTotalJurors === 0 &&
    safeCompletedJurors === 0 &&
    safeInProgressJurors === 0 &&
    safeEditingJurors === 0;
  const jurorTheme = isEmpty
    ? "empty"
    : (safeInProgressJurors === 0 && safeEditingJurors === 0 ? "completed" : "inprogress");
  const evalTheme = safeTotalEvaluations === 0
    ? "empty"
    : (safeCompletedEvaluations === safeTotalEvaluations ? "completed" : "inprogress");
  const jurorValue = (v) => (isEmpty ? "—" : v);
  const evalValue = safeTotalEvaluations === 0 ? "—" : `${safeCompletedEvaluations}/${safeTotalEvaluations}`;
  return (
    <div id={id} className="results-status-bar" role="group" aria-label="Results status metrics">
      <span
        className={`status-chip status-chip--${jurorTheme}`}
        aria-label={`Jurors: total ${safeTotalJurors}, completed ${safeCompletedJurors}, in progress ${safeInProgressJurors}, editing ${safeEditingJurors}`}
      >
        <span className="status-block">
          <UsersLucideIcon />
          <span className="status-value">{jurorValue(safeTotalJurors)}</span>
        </span>
        <span className="status-sep" aria-hidden="true">·</span>
        <span className="status-block">
          <CheckCircle2Icon />
          <span className="status-value">{jurorValue(safeCompletedJurors)}</span>
        </span>
        <span className="status-sep" aria-hidden="true">·</span>
        <span className="status-block">
          <HourglassIcon />
          <span className="status-value">{jurorValue(safeInProgressJurors)}</span>
        </span>
        <span className="status-sep" aria-hidden="true">·</span>
        <span className="status-block">
          <PencilIcon />
          <span className="status-value">{jurorValue(safeEditingJurors)}</span>
        </span>
      </span>
      <span
        className={`status-chip status-chip--${evalTheme}`}
        aria-label={`Evaluated: ${safeCompletedEvaluations} out of ${safeTotalEvaluations}`}
      >
        <span className="status-block">
          <ListChecksIcon />
          <span className="status-value">{evalValue}</span>
        </span>
      </span>
    </div>
  );
}

export default function AdminPanel({ adminPass, onBack, onAuthError, onInitialLoadDone }) {
  const [data,        setData]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState("");
  const [authError,   setAuthError]   = useState("");
  const [showStatus,  setShowStatus]  = useState(true);
  const [activeTab,   setActiveTab]   = useState(() => {
    const s = readSection("tab");
    const valid = ["summary", "dashboard", "detail", "jurors", "matrix"];
    return valid.includes(s.activeTab) ? s.activeTab : "summary";
  });
  const [lastRefresh, setLastRefresh] = useState(null);
  const [tabOverflow, setTabOverflow] = useState(false);
  const [tabHintLeft, setTabHintLeft] = useState(false);
  const [tabHintRight, setTabHintRight] = useState(false);
  const tabBarRef = useRef(null);

  // PIN reset feedback
  const [pinResetTarget, setPinResetTarget] = useState(null); // { juryName, juryDept, jurorId }
  const [pinResetStatus, setPinResetStatus] = useState("idle");   // "idle" | "loading" | "success" | "error"
  const [pinResetError, setPinResetError] = useState("");
  const pinResetModalRef = useRef(null);

  // Track whether the very first data fetch has resolved.
  const initialLoadFiredRef = useRef(false);

  // Keep adminPass current in a ref so async calls always
  // use the latest value without causing re-renders.
  const passRef = useRef(adminPass);
  useEffect(() => { passRef.current = adminPass; }, [adminPass]);
  const getAdminPass = () => passRef.current || sessionStorage.getItem("ee492_admin_pass") || "";

  // ── Data fetch ────────────────────────────────────────────
  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      const pass = getAdminPass();
      if (!pass) {
        setData([]);
        setAuthError("Enter the admin password to load results.");
        return;
      }

      const json = await getFromSheet({ action: "export", pass });

      if (json?.status === "unauthorized") {
        setData([]);
        if (onAuthError) { onAuthError("Invalid password"); return; }
        setAuthError("Incorrect password.");
        return;
      }
      if (json?.status !== "ok" || !Array.isArray(json?.rows)) {
        throw new Error("Unexpected response format.");
      }

      // Cache password for the duration of this browser session.
      try { sessionStorage.setItem("ee492_admin_pass", pass); } catch {}

      const parsed = json.rows.map((row) => ({
        juryName:    String(row["Juror Name"]  ?? row["Your Name"] ?? ""),
        juryDept:    String(row["Department / Institution"] ?? row["Department"] ?? ""),
        timestamp:   row["Timestamp"] || "",
        tsMs:        tsToMillis(row["Timestamp"] || ""),
        projectId:   toNum(row["Group No"]),
        projectName: String(row["Group Name"] ?? ""),
        jurorId:     String(row["Juror ID"] ?? ""),
        technical:   toNumOrEmpty(row["Technical (30)"]),
        design:      toNumOrEmpty(row["Written (30)"]),
        delivery:    toNumOrEmpty(row["Oral (30)"]),
        teamwork:    toNumOrEmpty(row["Teamwork (10)"]),
        total:       toNumOrEmpty(row["Total (100)"]),
        comments:    row["Comments"] || "",
        status:      String(row["Status"] ?? "all_submitted"),
        // EditingFlag (column 13) — set to "editing" by resetJuror,
        // cleared when the juror re-submits with all_submitted status.
        editingFlag: String(row["EditingFlag"] ?? ""),
      }));

      setData(dedupeAndSort(parsed));
      setLastRefresh(new Date());
      setAuthError("");
      if (!initialLoadFiredRef.current) {
        initialLoadFiredRef.current = true;
        onInitialLoadDone?.();
      }
    } catch (e) {
      if (onAuthError) { onAuthError("Connection error — try again."); return; }
      setError("Could not load data: " + e.message);
      setData([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const updateTabHints = () => {
    const el = tabBarRef.current;
    if (!el) return;
    const maxScroll = el.scrollWidth - el.clientWidth;
    const hasOverflow = maxScroll > 2;
    setTabOverflow(hasOverflow);
    if (!hasOverflow) {
      setTabHintLeft(false);
      setTabHintRight(false);
      return;
    }
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft < maxScroll - 4;
    setTabHintLeft(left);
    setTabHintRight(right);
  };

  useEffect(() => {
    updateTabHints();
    window.addEventListener("resize", updateTabHints);
    return () => window.removeEventListener("resize", updateTabHints);
  }, [activeTab, showStatus]);

  const closePinReset = useCallback(() => {
    setPinResetTarget(null);
    setPinResetStatus("idle");
    setPinResetError("");
  }, []);

  // Lock body scroll while PIN reset modal is open.
  useEffect(() => {
    if (pinResetTarget) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [pinResetTarget]);

  // Focus first action button when modal enters success/error state.
  useEffect(() => {
    if (!pinResetTarget) return;
    if (pinResetStatus === "success" || pinResetStatus === "error") {
      const el = pinResetModalRef.current?.querySelector("button");
      el?.focus();
    }
  }, [pinResetTarget, pinResetStatus]);

  // ── PIN reset ─────────────────────────────────────────────
  const handlePinReset = async (juryName, juryDept, jurorId) => {
    setPinResetTarget({ juryName, juryDept, jurorId });
    setPinResetStatus("loading");
    setPinResetError("");
    try {
      const pass = getAdminPass();
      const json = await getFromSheet({
        action: "resetPin",
        jurorId: jurorId.trim(),
        pass,
      });
      if (json.status === "ok") {
        setPinResetStatus("success");
      } else {
        setPinResetStatus("error");
        setPinResetError(json.message || "Reset failed.");
      }
    } catch {
      setPinResetStatus("error");
      setPinResetError("Network error. Please try again.");
    }
  };

  const handleAllowEdit = async (_juryName, _juryDept, jurorId) => {
    try {
      const pass = getAdminPass();
      return await allowJurorEdit(jurorId.trim(), pass);
    } catch {
      return { status: "error" };
    }
  };

  const retryPinReset = useCallback(() => {
    if (!pinResetTarget) return;
    handlePinReset(pinResetTarget.juryName, pinResetTarget.juryDept, pinResetTarget.jurorId || "");
  }, [pinResetTarget]);

  const handlePinResetKeyDown = useCallback((e) => {
    if (!pinResetTarget) return;
    if (e.key === "Escape") {
      if (pinResetStatus !== "loading") closePinReset();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = pinResetModalRef.current?.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }, [pinResetTarget, pinResetStatus, closePinReset]);

  // ── Derived data ──────────────────────────────────────────

  // Unique jurors by key — prevents same-name/different-dept collisions.
  const uniqueJurors = useMemo(() => {
    const seen = new Map(); // key → { key, name, dept, jurorId }
    data.forEach((d) => {
      if (!d.juryName) return;
      const key = rowKey(d);
      if (!seen.has(key))
        seen.set(key, { key, name: d.juryName.trim(), dept: d.juryDept.trim(), jurorId: d.jurorId });
    });
    return [...seen.values()].sort((a, b) => cmp(a.name, b.name));
  }, [data]);

  const groups = useMemo(
    () => PROJECT_LIST.map((p) => ({ id: p.id, label: `Group ${p.id}`, desc: p.desc || "" }))
      .sort((a, b) => a.id - b.id),
    []
  );

  // Key → dept map for MatrixTab.
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

  // Only rows with all_submitted count towards rankings and averages.
  const submittedData = useMemo(
    () => data.filter((r) => r.status === "all_submitted"),
    [data]
  );
  const completedData = useMemo(
    () => data.filter((r) => r.status === "group_submitted" || r.status === "all_submitted"),
    [data]
  );

  const projectStats = useMemo(() => {
    return PROJECT_LIST.map((p) => {
      const rows = submittedData.filter((d) => d.projectId === p.id);
      if (!rows.length) {
        return { id: p.id, name: p.name, desc: p.desc, students: p.students, count: 0, avg: {}, totalAvg: 0, totalMin: 0, totalMax: 0 };
      }
      const avg = {};
      CRITERIA_LIST.forEach((c) => {
        avg[c.id] = rows.reduce((s, r) => s + (r[c.id] || 0), 0) / rows.length;
      });
      const totals = rows.map((r) => r.total);
      return {
        id: p.id, name: p.name, desc: p.desc, students: p.students,
        count:    rows.length,
        avg,
        totalAvg: totals.reduce((a, b) => a + b, 0) / totals.length,
        totalMin: Math.min(...totals),
        totalMax: Math.max(...totals),
      };
    });
  }, [submittedData]);

  const dashboardStats = useMemo(
    () => projectStats.map((s) => ({ ...s, name: `Group ${s.id}` })),
    [projectStats]
  );
  const ranked = useMemo(
    () => [...projectStats].sort((a, b) => b.totalAvg - a.totalAvg),
    [projectStats]
  );

  const jurorStats = useMemo(() => {
    return uniqueJurors.map(({ key, name, dept, jurorId }) => {
      const rows           = data.filter((d) => rowKey(d) === key);
      const completed      = rows.filter((r) => r.status === "group_submitted" || r.status === "all_submitted");
      const finalSubmitted = rows.filter((r) => r.status === "all_submitted");
      const inProgress     = rows.filter((r) => r.status === "in_progress");
      const latestTs       = rows.reduce((mx, r) => (r.tsMs > mx ? r.tsMs : mx), 0);
      const latestRow      = rows.find((r) => r.tsMs === latestTs) || rows[0];

      const overall =
        finalSubmitted.length === TOTAL_GROUPS ? "all_submitted" :
        (completed.length > 0 || inProgress.length > 0) ? "in_progress" :
        "not_started";

      return {
        key, jury: name, dept, jurorId, rows,
        submitted: completed, // backwards-compatible alias
        completed, finalSubmitted, inProgress,
        latestTs, latestRow, overall,
      };
    });
  }, [uniqueJurors, data]);

  const statusMetrics = useMemo(() => {
    const totalJurors = uniqueJurors.length;
    const completedEvaluations = completedData.length;
    const totalEvaluations = totalJurors * TOTAL_GROUPS;
    const finalByJuror = new Map();
    data.forEach((r) => {
      if (r.status !== "all_submitted") return;
      const key = rowKey(r);
      if (!finalByJuror.has(key)) finalByJuror.set(key, new Set());
      finalByJuror.get(key).add(r.projectId);
    });
    const completedJurors = uniqueJurors.filter(
      (j) => (finalByJuror.get(j.key)?.size || 0) >= TOTAL_GROUPS
    ).length;
    const editingKeys = new Set(
      data
        .filter((r) => r.status === "editing" || r.editingFlag === "editing")
        .map((r) => rowKey(r))
    );
    const inProgressKeys = new Set(
      data
        .filter((r) => r.status === "in_progress")
        .map((r) => rowKey(r))
        .filter((k) => !editingKeys.has(k))
    );
    const inProgressJurors = inProgressKeys.size;
    const editingJurors = editingKeys.size;
    return {
      completedJurors,
      totalJurors,
      completedEvaluations,
      totalEvaluations,
      inProgressJurors,
      editingJurors,
    };
  }, [data, completedData, uniqueJurors, rowKey]);

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

  const lastRefreshDate = lastRefresh
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Istanbul",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(lastRefresh).replace(/\//g, ".")
    : "";
  const lastRefreshTime = lastRefresh
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Istanbul",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(lastRefresh)
    : "";

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
                <span className="last-updated-text">
                  <span className="last-updated-date">{lastRefreshDate}</span>
                  <span className="last-updated-time">{lastRefreshTime}</span>
                </span>
              </span>
            )}
            <button
              className={`refresh-btn${loading ? " is-loading" : ""}`}
              onClick={fetchData}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshIcon />
            </button>
          </div>
        </div>
        {showStatus && <ResultsStatusBar id="results-status-bar" metrics={statusMetrics} />}

        {/* Tab bar */}
        <div className="tab-bar-wrap">
          <div
            className="tab-bar"
            ref={tabBarRef}
            onScroll={updateTabHints}
          >
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

      {/* PIN reset modal */}
      {pinResetTarget && (
        <div
          className="pin-reset-modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-live="polite"
          onKeyDown={handlePinResetKeyDown}
          onClick={() => { if (pinResetStatus !== "loading") closePinReset(); }}
        >
          <div
            ref={pinResetModalRef}
            className={`pin-reset-modal-card pin-reset-${pinResetStatus}`}
            onClick={(e) => e.stopPropagation()}
          >
            {pinResetStatus === "loading" && (
              <>
                <div className="pin-reset-icon pin-reset-icon--spin" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2v4"/><path d="m16.2 7.8 2.9-2.9"/><path d="M18 12h4"/><path d="m16.2 16.2 2.9 2.9"/><path d="M12 18v4"/><path d="m4.9 19.1 2.9-2.9"/><path d="M2 12h4"/><path d="m4.9 4.9 2.9 2.9"/>
                  </svg>
                </div>
                <div className="pin-reset-title">Resetting PIN…</div>
                <div className="pin-reset-subtitle">
                  Updating access for{" "}
                  <strong style={{ fontWeight: 700, color: "#0f172a" }}>
                    {pinResetTarget.juryName}
                  </strong>
                </div>
              </>
            )}

            {pinResetStatus === "success" && (
              <>
                <div className="pin-reset-icon pin-reset-icon--pop is-success" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <path d="m9 12 2 2 4-4"/>
                  </svg>
                </div>
                <div className="pin-reset-title">PIN reset</div>
                <div className="pin-reset-subtitle">
                  <strong style={{ fontWeight: 700, color: "#0f172a" }}>
                    {pinResetTarget.juryName}
                  </strong>{" "}
                  will receive a new PIN on next login.
                </div>
                <div className="pin-reset-actions">
                  <button className="premium-btn-primary pin-reset-done" type="button" onClick={closePinReset}>
                    Done
                  </button>
                </div>
              </>
            )}

            {pinResetStatus === "error" && (
              <>
                <div className="pin-reset-icon pin-reset-icon--pop is-error" aria-hidden="true">
                  <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86a2 2 0 0 1 3.42 0l7.2 12.8A2 2 0 0 1 19.2 20H4.8a2 2 0 0 1-1.71-3.34z"/>
                    <path d="M12 9v4"/>
                    <path d="M12 17h.01"/>
                  </svg>
                </div>
                <div className="pin-reset-title">Couldn’t reset PIN</div>
                <div className="pin-reset-subtitle">
                  Please try again. If the issue persists, check the Apps Script logs.
                </div>
                {pinResetError && (
                  <div className="pin-reset-hint">{pinResetError}</div>
                )}
                <div className="pin-reset-actions">
                  <button className="premium-btn-primary" type="button" onClick={retryPinReset}>
                    Try again
                  </button>
                  <button className="premium-btn-secondary" type="button" onClick={closePinReset}>
                    Close
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Tab content */}
      {!loading && !error && !authError && (
        <div className="admin-body">
          {activeTab === "summary"   && <SummaryTab   ranked={ranked} submittedData={submittedData} />}
          {activeTab === "dashboard" && <DashboardTab dashboardStats={dashboardStats} submittedData={submittedData} lastRefresh={lastRefresh} loading={loading} error={error} />}
          {activeTab === "detail"    && <DetailsTab   data={data} jurors={uniqueJurors} jurorColorMap={jurorColorMap} />}
          {activeTab === "jurors"    && (
            <JurorsTab
              jurorStats={jurorStats}
              jurors={uniqueJurors}
              onPinReset={handlePinReset}
              onAllowEdit={handleAllowEdit}
            />
          )}
          {activeTab === "matrix"    && (
            <MatrixTab data={data} jurors={uniqueJurors} groups={groups} jurorDeptMap={jurorDeptMap} />
          )}
        </div>
      )}
    </div>
  );
}
