// src/admin/DashboardTab.jsx
// ── Charts dashboard ──────────────────────────────────────────

import { useEffect, useRef, useState } from "react";
import { APP_CONFIG } from "../config";
import { DownloadIcon } from "../shared/Icons";
import {
  OutcomeByGroupChart,
  OutcomeOverviewChart,
  CompetencyRadarChart,
  CriterionBoxPlotChart,
  JurorConsistencyHeatmap,
  RubricAchievementChart,
  MudekBadge,
} from "../Charts";

// ── Helpers ───────────────────────────────────────────────────
function formatDashboardTs(date) {
  if (!date) return "—";
  return date.toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).replace(",", " ·").replace(/\//g, ".");
}

// ── Loading skeleton ──────────────────────────────────────────
function DashboardSkeleton() {
  return (
    <div className="dashboard-loading">
      <div className="dashboard-skeleton-row">
        <div className="skeleton-card skeleton-wide" />
      </div>
      <div className="dashboard-skeleton-row">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
      <div className="dashboard-skeleton-row">
        <div className="skeleton-card skeleton-wide" />
      </div>
      <div className="dashboard-skeleton-row">
        <div className="skeleton-card" />
        <div className="skeleton-card" />
      </div>
    </div>
  );
}

// ── Error state ───────────────────────────────────────────────
function DashboardError() {
  return (
    <div className="dashboard-state-card">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#FCA5A5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p className="dashboard-state-title">Could not load data</p>
      <span className="dashboard-state-sub">Check your connection and refresh the page.</span>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────
function DashboardEmpty() {
  return (
    <div className="dashboard-state-card">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#D1D5DB" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5"/><line x1="10" y1="12" x2="14" y2="12"/>
      </svg>
      <p className="dashboard-state-title">No data available</p>
      <span className="dashboard-state-sub">Evaluations will appear here once jurors submit their scores.</span>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────
export default function DashboardTab({ dashboardStats, submittedData, lastRefresh, loading, error }) {
  const wrapRef      = useRef(null);
  const restoreRef   = useRef(null);
  const [exporting, setExporting] = useState(false);

  // ── PDF export — window.print() with vector SVG ───────────────
  async function handleExportPdf() {
    if (exporting || !wrapRef.current) return;
    setExporting(true);

    const wrap = wrapRef.current;
    wrap.classList.add("print-mode");

    let done = false;
    const restore = () => {
      if (done) return;
      done = true;
      wrap.classList.remove("print-mode");
      clearTimeout(safariTimer);
      window.removeEventListener("afterprint", restore);
      printMq.removeEventListener("change", onMqChange);
      restoreRef.current = null;
      setExporting(false);
    };
    restoreRef.current = restore;

    // Chrome / Firefox: afterprint fires on dialog close (print or cancel)
    window.addEventListener("afterprint", restore, { once: true });

    // Safari: afterprint is unreliable — watch the print media query instead
    const printMq = window.matchMedia("print");
    const onMqChange = (e) => { if (!e.matches) restore(); };
    printMq.addEventListener("change", onMqChange);

    // Hard fallback: give up after 60 s (user left dialog open)
    const safariTimer = setTimeout(restore, 60_000);

    // Wait for fonts + two layout passes before handing to the browser
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 150));

    window.print();
  }

  // Restore print state on unmount (e.g. tab switch while dialog is open)
  useEffect(() => () => { restoreRef.current?.(); }, []);

  // ── Render states ────────────────────────────────────────────
  const showPrint = formatDashboardTs(lastRefresh);

  if (loading) {
    return (
      <div className="dashboard-print-wrap">
        <DashboardSkeleton />
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-print-wrap">
        <DashboardError />
      </div>
    );
  }

  if (!submittedData || submittedData.length === 0) {
    return (
      <div className="dashboard-print-wrap">
        <DashboardEmpty />
      </div>
    );
  }

  return (
    <div className="dashboard-print-wrap" ref={wrapRef}>
      {/* Print-only header — hidden on screen, shown during PDF export */}
      <div className="print-header">
        <div className="print-header-title">{APP_CONFIG.appTitle}</div>
        <div className="print-header-sub">{APP_CONFIG.courseName} — {APP_CONFIG.university}</div>
        <div className="print-header-meta">
          Dashboard Report &nbsp;·&nbsp; {showPrint}
          &nbsp;·&nbsp; {submittedData.length} final submission{submittedData.length !== 1 ? "s" : ""}
          &nbsp;·&nbsp; {dashboardStats.length} group{dashboardStats.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Export button — hidden during export */}
      <div className="dashboard-toolbar no-print">
        <div className="dashboard-toolbar-left">
          <MudekBadge />
        </div>
        <span className="dashboard-toolbar-divider" aria-hidden="true" />
        <button className="pdf-export-btn" onClick={handleExportPdf} disabled={exporting}>
          <DownloadIcon />
          {exporting ? "Preparing PDF…" : "Export PDF"}
        </button>
      </div>

      {/* Row 1: Outcome by Group — full width */}
      <div className="dashboard-section-label" lang="en">Outcome Distribution</div>
      <div className="dashboard-grid dashboard-row" data-row="1">
        <div className="chart-span-2 chart-card dashboard-card" id="chart-1">
          <OutcomeByGroupChart stats={dashboardStats} />
        </div>
      </div>

      {/* Row 2: Programme Averages (left) + Radar (right) */}
      <div className="dashboard-section-label" lang="en">Programme Overview</div>
      <div className="dashboard-grid dashboard-row" data-row="2">
        <div className="chart-card dashboard-card" id="chart-2">
          <OutcomeOverviewChart data={submittedData} />
        </div>
        <div className="chart-card dashboard-card" id="chart-3">
          <CompetencyRadarChart stats={dashboardStats} />
        </div>
      </div>

      {/* Row 3: Juror Consistency Heatmap — full width */}
      <div className="dashboard-section-label" lang="en">Juror Consistency</div>
      <div className="dashboard-grid dashboard-row" data-row="3">
        <div className="chart-span-2 chart-card dashboard-card" id="chart-4">
          <JurorConsistencyHeatmap stats={dashboardStats} data={submittedData} />
        </div>
      </div>

      {/* Row 4: Boxplot (left) + Rubric Achievement (right) */}
      <div className="dashboard-section-label" lang="en">Criterion Analysis</div>
      <div className="dashboard-grid dashboard-row" data-row="4">
        <div className="chart-card dashboard-card" id="chart-5">
          <CriterionBoxPlotChart data={submittedData} />
        </div>
        <div className="chart-card dashboard-card" id="chart-6">
          <RubricAchievementChart data={submittedData} />
        </div>
      </div>
    </div>
  );
}
