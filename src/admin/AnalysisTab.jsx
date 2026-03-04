// src/admin/AnalysisTab.jsx
// ── Charts dashboard (renamed from DashboardTab) ──────────────

import { useEffect, useRef, useState } from "react";
import { formatDashboardTs } from "./utils";
import { DownloadIcon } from "../shared/Icons";
import {
  OutcomeByGroupChart,
  OutcomeOverviewChart,
  CompetencyRadarChart,
  CriterionBoxPlotChart,
  JurorConsistencyHeatmap,
  RubricAchievementChart,
  RadarPrintAll,
  MudekBadge,
  OutcomeByGroupChartPrint,
  OutcomeOverviewChartPrint,
  JurorConsistencyHeatmapPrint,
  CriterionBoxPlotChartPrint,
  RubricAchievementChartPrint,
} from "../Charts";

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
export default function AnalysisTab({ dashboardStats, submittedData, lastRefresh, loading, error, semesterName = "" }) {
  const restoreRef   = useRef(null);
  const [exporting, setExporting] = useState(false);

  // ── PDF export ─────────────────────────────────────────────
  // The .print-report section is always in the DOM (just display:none on screen).
  // All print-only SVGs are already rendered and computed, so window.print()
  // sees them immediately — no DOM measuring or resize loops needed.
  async function handleExportPdf() {
    if (exporting) return;
    setExporting(true);

    let done = false;
    const originalTitle = document.title;
    const today = new Date();
    const dd = String(today.getDate()).padStart(2, "0");
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const yyyy = String(today.getFullYear());
    const hh = String(today.getHours()).padStart(2, "0");
    const min = String(today.getMinutes()).padStart(2, "0");
    const safeSemester = String(semesterName || "Semester")
      .trim()
      .replace(/\s+/g, "_")
      .replace(/[^a-zA-Z0-9_-]/g, "");
    document.title = `TEDU_EE491-492_Jury_Report_${safeSemester}_${dd}${mm}${yyyy}_${hh}${min}.pdf`;

    const restore = () => {
      if (done) return;
      done = true;
      document.title = originalTitle;
      clearTimeout(safariTimer);
      window.removeEventListener("afterprint", restore);
      printMq.removeEventListener("change", onMqChange);
      restoreRef.current = null;
      setExporting(false);
    };
    restoreRef.current = restore;

    // Chrome / Firefox: afterprint fires reliably on dialog close
    window.addEventListener("afterprint", restore, { once: true });

    // Safari: afterprint is unreliable — watch media query change instead
    const printMq = window.matchMedia("print");
    const onMqChange = (e) => { if (!e.matches) restore(); };
    printMq.addEventListener("change", onMqChange);

    // Hard fallback: 60 s if user leaves print dialog open
    const safariTimer = setTimeout(restore, 60_000);

    // Wait for fonts + two layout passes
    await document.fonts.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

    window.print();
  }

  // Clean up on unmount (e.g. tab switch while dialog is open)
  useEffect(() => () => { restoreRef.current?.(); }, []);

  // ── Render states ────────────────────────────────────────────
  const showPrint = formatDashboardTs(lastRefresh);
  const printDate = (() => {
    const dt = lastRefresh ? new Date(lastRefresh) : new Date();
    if (Number.isNaN(dt.getTime())) return showPrint;
    const datePart = dt.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    const timePart = dt.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${datePart} · ${timePart}`;
  })();
  const semesterLabel = semesterName ? `${semesterName} Semester` : "Semester";

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
    <div className="dashboard-print-wrap">
      {/* ═══════════════════════════════════════════════════════
          SCREEN CHARTS — hidden in print, replaced by .print-report
          ═══════════════════════════════════════════════════════ */}
      <div className="screen-charts">
        {/* Export button */}
        <div className="dashboard-toolbar">
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

      {/* ═══════════════════════════════════════════════════════
          PRINT REPORT — always in DOM (display:none on screen).
          Uses dedicated print-only SVG components with fixed viewBox
          and no ResizeObserver / scroll wrappers.

          Layout (A4 portrait, one chart per page):
          Page 1: Outcome by Group
          Page 2: Programme-Level Outcome Averages
          Page 3: Competency Profiles (all groups radar)
          Page 4: Juror Consistency Heatmap
          Page 5: Score Distribution by Criterion (Boxplot)
          Page 6: Achievement Level Distribution (Rubric)
          ═══════════════════════════════════════════════════════ */}
      <div className="print-report">
        {/* Print-only header — appears above page 1 */}
        <div className="print-header">
          <div className="print-header-title">TED University — Department of Electrical &amp; Electronics Engineering</div>
          <div className="print-header-sub">Senior Project (EE 491 / EE 492) Jury Assessment Report</div>
          <div className="print-header-meta">
            <div>{semesterLabel}</div>
            <div>Report Generated: {printDate}</div>
            <div>{submittedData.length} Final Submission{submittedData.length !== 1 ? "s" : ""} · {dashboardStats.length} Project Group{dashboardStats.length !== 1 ? "s" : ""}</div>
          </div>
        </div>

        {/* Page 1: Outcome by Group */}
        <section className="print-page">
          <div className="print-card-title">Outcome Achievement by Group</div>
          <div className="print-card-note">Normalized score per MÜDEK-mapped criterion, by group.</div>
          <OutcomeByGroupChartPrint stats={dashboardStats} />
        </section>

        {/* Page 2: Programme Averages */}
        <section className="print-page">
          <div className="print-card-title">Programme-Level Outcome Averages</div>
          <div className="print-card-note">Grand mean ±1 SD per outcome, all groups &amp; jurors.</div>
          <OutcomeOverviewChartPrint data={submittedData} />
        </section>

        {/* Page 3+: Competency Radar (one group per page) */}
        <RadarPrintAll stats={dashboardStats} />

        {/* Page 4: Juror Consistency Heatmap */}
        <section className="print-page">
          <div className="print-card-title">Juror Consistency Heatmap (CV)</div>
          <div className="print-card-note">CV = σ/μ × 100. Low CV = good inter-juror agreement.</div>
          <JurorConsistencyHeatmapPrint stats={dashboardStats} data={submittedData} />
        </section>

        {/* Page 5: Score Distribution by Criterion */}
        <section className="print-page">
          <div className="print-card-title">Score Distribution by Criterion</div>
          <div className="print-card-note">Inter-juror spread per criterion — measurement reliability evidence.</div>
          <CriterionBoxPlotChartPrint data={submittedData} />
        </section>

        {/* Page 6: Achievement Level Distribution */}
        <section className="print-page">
          <div className="print-card-title">Achievement Level Distribution</div>
          <div className="print-card-note">% of evaluations per rubric band — MÜDEK CI evidence.</div>
          <RubricAchievementChartPrint data={submittedData} />
        </section>
      </div>
    </div>
  );
}
