// src/admin/AnalysisTab.jsx
// ── Charts dashboard (renamed from DashboardTab) ──────────────

import { useEffect, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { formatDashboardTs, buildExportFilename } from "./utils";
import { CRITERIA } from "../config";
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

// ── Export helpers ───────────────────────────────────────────
const OUTCOMES = CRITERIA.map((c) => ({
  key: c.id,
  label: c.shortLabel || c.label,
  max: c.max,
  rubric: c.rubric || [],
}));

function mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / arr.length);
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] === undefined) return sorted[base];
  return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
}

function outcomeValues(rows, key) {
  return (rows || [])
    .map((r) => Number(r[key]))
    .filter((v) => Number.isFinite(v));
}

function fmt1(v) {
  return Number.isFinite(v) ? Number(v.toFixed(1)) : null;
}

function fmt2(v) {
  return Number.isFinite(v) ? Number(v.toFixed(2)) : null;
}


function addTableSheet(wb, name, title, headers, rows, extraSections = []) {
  const aoa = [
    [title],
    [],
    headers,
    ...rows,
  ];
  extraSections.forEach((section) => {
    if (!section) return;
    aoa.push([], [section.title], section.headers, ...section.rows);
  });
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, name);
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
export default function AnalysisTab({ dashboardStats, submittedData, lastRefresh, loading, error, semesterName = "" }) {
  const restoreRef   = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [exportingExcel, setExportingExcel] = useState(false);

  // ── PDF export ─────────────────────────────────────────────
  // The .print-report section is always in the DOM (just display:none on screen).
  // All print-only SVGs are already rendered and computed, so window.print()
  // sees them immediately — no DOM measuring or resize loops needed.
  async function handleExportPdf() {
    if (exporting) return;
    setExporting(true);

    let done = false;
    const originalTitle = document.title;
    document.title = buildExportFilename("report", semesterName, "pdf");

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

  // ── Excel export ───────────────────────────────────────────
  function buildOutcomeByGroupDataset() {
    const groups = (dashboardStats || []).filter((s) => s.count > 0);
    const headers = [
      "Group",
      ...OUTCOMES.flatMap((o) => [`${o.label} Avg`, `${o.label} (%)`]),
    ];
    const rows = groups.map((g) => {
      const cells = OUTCOMES.flatMap((o) => {
        const avgRaw = Number(g.avg?.[o.key] || 0);
        const pct = o.max > 0 ? (avgRaw / o.max) * 100 : 0;
        return [fmt2(avgRaw), fmt1(pct)];
      });
      return [g.name, ...cells];
    });
    return {
      sheet: "Outcome Group",
      title: "Outcome Achievement by Group",
      headers,
      rows,
    };
  }

  function buildProgrammeAveragesDataset() {
    const rows = submittedData || [];
    const headers = ["Outcome", "Max", "Avg (raw)", "Avg (%)", "SD (%)", "N"];
    const dataRows = OUTCOMES.map((o) => {
      const vals   = outcomeValues(rows, o.key);
      const avgRaw = vals.length ? mean(vals) : 0;
      const pct    = o.max > 0 ? (avgRaw / o.max) * 100 : 0;
      const sd     = vals.length > 1 ? (stdDev(vals) / o.max) * 100 : 0;
      return [o.label, o.max, fmt2(avgRaw), fmt1(pct), fmt1(sd), vals.length];
    });
    return {
      sheet: "Programme Avg",
      title: "Programme-Level Outcome Averages",
      headers,
      rows: dataRows,
    };
  }

  function buildCompetencyProfilesDataset() {
    const groups = (dashboardStats || []).filter((s) => s.count > 0);
    const headers = ["Group", ...OUTCOMES.map((o) => `${o.label} (%)`)];
    const rows = groups.map((g) => {
      const vals = OUTCOMES.map((o) => {
        const avgRaw = Number(g.avg?.[o.key] || 0);
        const pct = o.max > 0 ? (avgRaw / o.max) * 100 : 0;
        return fmt1(pct);
      });
      return [g.name, ...vals];
    });
    const cohort = OUTCOMES.map((o) => {
      const vals = groups.map((g) => {
        const avgRaw = Number(g.avg?.[o.key] || 0);
        return o.max > 0 ? (avgRaw / o.max) * 100 : 0;
      });
      return fmt1(mean(vals));
    });
    if (rows.length) rows.push(["Cohort Average", ...cohort]);
    return {
      sheet: "Competency",
      title: "Competency Profiles (Radar Data)",
      headers,
      rows,
    };
  }

  function buildJurorConsistencyDataset() {
    const groups = (dashboardStats || []).filter((s) => s.count > 0);
    const rows   = submittedData || [];
    const headers = ["Group", ...OUTCOMES.map((o) => o.label)];

    const buildMatrix = (metric) =>
      groups.map((g) => {
        const cells = OUTCOMES.map((o) => {
          const vals = rows
            .filter((r) => r.projectId === g.id)
            .map((r) => Number(r[o.key]))
            .filter((v) => Number.isFinite(v));
          if (!vals.length) return null;
          const m = mean(vals);
          if (metric === "n") return vals.length;
          if (metric === "mean") return fmt1(o.max > 0 ? (m / o.max) * 100 : 0);
          if (metric === "sd") return fmt2(stdDev(vals));
          if (metric === "cv") {
            if (vals.length < 2 || !m) return null;
            return fmt1((stdDev(vals) / m) * 100);
          }
          return null;
        });
        return [g.name, ...cells];
      });

    return {
      sheet: "Juror CV",
      title: "Juror Consistency Heatmap (CV%)",
      headers,
      rows: buildMatrix("cv"),
      extra: [
        { title: "Mean (%) by Group x Criterion", headers, rows: buildMatrix("mean") },
        { title: "SD by Group x Criterion", headers, rows: buildMatrix("sd") },
        { title: "N (Juror Count) by Group x Criterion", headers, rows: buildMatrix("n") },
      ],
    };
  }

  function buildCriterionBoxplotDataset() {
    const rows = submittedData || [];
    const headers = [
      "Outcome",
      "Q1 (%)",
      "Median (%)",
      "Q3 (%)",
      "Whisker Min (%)",
      "Whisker Max (%)",
      "Outliers (count)",
      "N",
    ];
    const dataRows = OUTCOMES.map((o) => {
      const vals = rows
        .map((r) => Number(r[o.key]))
        .filter((v) => Number.isFinite(v) && v > 0)
        .map((v) => (v / o.max) * 100)
        .sort((a, b) => a - b);
      if (!vals.length) return [o.label, null, null, null, null, null, 0, 0];
      const q1 = quantile(vals, 0.25);
      const med = quantile(vals, 0.5);
      const q3 = quantile(vals, 0.75);
      const iqr = q3 - q1;
      const low = q1 - 1.5 * iqr;
      const high = q3 + 1.5 * iqr;
      const whiskerMin = vals.find((v) => v >= low) ?? vals[0];
      const whiskerMax = [...vals].reverse().find((v) => v <= high) ?? vals[vals.length - 1];
      const outliers = vals.filter((v) => v < low || v > high);
      return [
        o.label,
        fmt1(q1),
        fmt1(med),
        fmt1(q3),
        fmt1(whiskerMin),
        fmt1(whiskerMax),
        outliers.length,
        vals.length,
      ];
    });
    return {
      sheet: "Boxplot",
      title: "Score Distribution by Criterion (Boxplot)",
      headers,
      rows: dataRows,
    };
  }

  function buildRubricAchievementDataset() {
    const rows = submittedData || [];
    const bands = [
      { key: "excellent", label: "Excellent" },
      { key: "good", label: "Good" },
      { key: "developing", label: "Developing" },
      { key: "insufficient", label: "Insufficient" },
    ];
    const classify = (v, rubric) => {
      if (!Number.isFinite(v)) return null;
      for (const band of rubric) {
        if (v >= band.min && v <= band.max) return band.level.toLowerCase();
      }
      return null;
    };
    const headers = [
      "Outcome",
      "Total",
      "Excellent (count)",
      "Excellent (%)",
      "Good (count)",
      "Good (%)",
      "Developing (count)",
      "Developing (%)",
      "Insufficient (count)",
      "Insufficient (%)",
    ];
    const dataRows = OUTCOMES.map((o) => {
      const criterion = CRITERIA.find((c) => c.id === o.key);
      const vals = rows.map((r) => Number(r[o.key])).filter((v) => Number.isFinite(v));
      const counts = { excellent: 0, good: 0, developing: 0, insufficient: 0 };
      vals.forEach((v) => {
        const k = classify(v, criterion?.rubric || []);
        if (k) counts[k] += 1;
      });
      const total = vals.length || 0;
      const pct = (n) => (total ? (n / total) * 100 : 0);
      return [
        o.label,
        total,
        counts.excellent,
        fmt1(pct(counts.excellent)),
        counts.good,
        fmt1(pct(counts.good)),
        counts.developing,
        fmt1(pct(counts.developing)),
        counts.insufficient,
        fmt1(pct(counts.insufficient)),
      ];
    });
    return {
      sheet: "Rubric Dist",
      title: "Achievement Level Distribution (Rubric)",
      headers,
      rows: dataRows,
    };
  }

  function exportExcelAll() {
    if (exportingExcel) return;
    setExportingExcel(true);
    try {
      const wb = XLSX.utils.book_new();
      const datasets = [
        buildOutcomeByGroupDataset(),
        buildProgrammeAveragesDataset(),
        buildCompetencyProfilesDataset(),
        buildJurorConsistencyDataset(),
        buildCriterionBoxplotDataset(),
        buildRubricAchievementDataset(),
      ];
      datasets.forEach((ds) => {
        addTableSheet(wb, ds.sheet, ds.title, ds.headers, ds.rows, ds.extra);
      });
      XLSX.writeFile(wb, buildExportFilename("analysis", semesterName));
    } finally {
      setExportingExcel(false);
    }
  }

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
          <button
            className="pdf-export-btn"
            onClick={handleExportPdf}
            disabled={exporting}
            aria-label={exporting ? "Preparing PDF export" : "Export PDF"}
            title={exporting ? "Preparing PDF…" : "Export PDF"}
          >
            <DownloadIcon />
            PDF
          </button>
          <button
            className="xlsx-export-btn"
            onClick={exportExcelAll}
            disabled={exportingExcel}
            aria-label={exportingExcel ? "Preparing Excel export" : "Export Excel"}
            title={exportingExcel ? "Preparing Excel…" : "Export Excel"}
          >
            <DownloadIcon />
            Excel
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
          <div className="print-header-sub">EE 492 — Senior Project II · Poster Jury Evaluation Report · {semesterLabel} </div>
          <div className="print-header-meta">
            <div>Report Generated: {printDate}</div>
            <div>{submittedData.length} Jury Evaluation{submittedData.length !== 1 ? "s" : ""} · {dashboardStats.length} Project Group{dashboardStats.length !== 1 ? "s" : ""}</div>
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
