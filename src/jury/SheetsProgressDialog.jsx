// src/jury/SheetsProgressDialog.jsx
// ============================================================
// Modal dialog shown after PIN verification.
//
// Always displayed — Sheets is the master source of truth.
// Shows how many groups have data in the sheet and lets the
// juror decide whether to:
//   • Continue  — load sheet data into the form
//   • Start Evaluation — ignore sheet data, start with empty form
//
// Props:
//   progress  { rows, filledCount, totalCount, allSubmitted, editAllowed }
//   projects  [{ project_id, group_no, project_title, group_students }]
//   onConfirm () → proceed with saved data
//   onFresh   () → proceed with empty data
// ============================================================

import { useState } from "react";
import {
  BadgeCheckIcon,
  SaveIcon,
  ChevronDownIcon,
  CheckIcon,
  HourglassIcon,
  PencilIcon,
  ClockIcon,
  InfoIcon,
  CircleIcon,
} from "../shared/Icons";
import MinimalLoaderOverlay from "../shared/MinimalLoaderOverlay";
import { formatTs as formatShortTs } from "../admin/utils";
import { GroupLabel, ProjectTitle, StudentNames } from "../components/EntityMeta";

// Status label + colour for each row returned by myscores.
function rowStatusChip(status) {
  if (status === "all_submitted" || status === "group_submitted" || status === "submitted") {
    return { label: "Submitted", tone: "submitted", icon: <CheckIcon /> };
  }
  if (status === "in_progress")     return { label: "In Progress", tone: "in-progress", icon: <HourglassIcon /> };
  return { label: "Not started", tone: "not-started", icon: <CircleIcon /> };
}

export default function SheetsProgressDialog({ progress, projects, onConfirm, onFresh }) {
  if (!progress) return null;

  // Loading sentinel — shown while fetchMyScores is in flight.
  const suppress = typeof document !== "undefined" &&
    document.body?.classList?.contains("auth-overlay-open");
  const showLoader = progress.loading && !suppress;

  const { rows, filledCount, totalCount, allSubmitted, editAllowed } = progress;
  const progressPct = totalCount ? Math.round((filledCount / totalCount) * 100) : 0;
  const barColor =
    progressPct === 100 ? "#22c55e" :
    progressPct > 66    ? "#84cc16" :
    progressPct > 33    ? "#eab308" :
    progressPct > 0     ? "#f97316" : "#e2e8f0";
  const hasData = rows && rows.length > 0;
  const projectList = Array.isArray(projects) ? projects : [];
  const [openGroup, setOpenGroup] = useState(null);
  const isEditing = hasData && rows.some((r) => r.editingFlag === "editing");

  const toggleGroup = (groupId) => {
    setOpenGroup((prev) => (prev === groupId ? null : groupId));
  };

  return (
    <>
      <MinimalLoaderOverlay open={showLoader} minDuration={400} />
      {!progress.loading && (
        <div className="premium-overlay spd-overlay">
          <div className="premium-card spd-card">

        {/* Header */}
        <div className="spd-header">
          <div className="spd-header-left">
            <div className="spd-icon spd-icon-state" aria-hidden="true">
              {allSubmitted ? (
                <BadgeCheckIcon />
              ) : hasData ? (
                <SaveIcon />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-save-icon lucide-save" aria-hidden="true">
                  <path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
                  <path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" />
                  <path d="M7 3v4a1 1 0 0 0 1 1h7" />
                </svg>
              )}
            </div>
            <div className="spd-header-main">
            <div className="spd-title" title={allSubmitted
              ? "All evaluations submitted"
              : hasData
              ? "Previous progress found"
              : "No previous evaluation found"}>
              {allSubmitted
                ? "All evaluations submitted"
                : hasData
                ? "Previous progress found"
                : "No previous evaluation found"}
            </div>
            <div className="spd-sub" title={`${filledCount} / ${totalCount} groups completed`}>
              {filledCount} / {totalCount} groups completed
            </div>
            </div>
          </div>
          {isEditing && (
            <div className="spd-header-meta">
              <span className="status-badge editing spd-editing-pill">
                <PencilIcon />
                Editing
              </span>
            </div>
          )}
        </div>

        <div className="spd-progress-wrap spd-progress-full">
          <div className="spd-progress-bar-bg">
            <div
              className="spd-progress-bar-fill"
              style={{ width: `${progressPct}%`, background: barColor }}
            />
          </div>
          <span className="spd-progress-label">{progressPct}%</span>
        </div>

        {/* Per-group status list */}
        <div className="spd-list">
          {hasData ? (
            projectList.map((p) => {
              const row = rows.find((r) => r.projectId === p.project_id);
              const chip = rowStatusChip(row?.status);
              const isNotStarted = chip.tone === "not-started";
              const total = row?.total ?? "—";
              const timestamp = formatShortTs(row?.timestamp || "—");
              const isOpen = openGroup === p.project_id;
              const name = `Group ${p.group_no}`;
              const students = p.group_students
                ? p.group_students.split(",").map((s) => s.trim()).filter(Boolean)
                : [];
              const hasDetails = Boolean(p.project_title) || students.length > 0;

              return (
                <div key={p.project_id} className={`spd-row-wrap${isNotStarted ? " is-not-started" : ""}`}>
                  <div className="spd-row">
                    <button
                      className="spd-row-left group-accordion-header"
                      type="button"
                      onClick={() => { if (hasDetails) toggleGroup(p.project_id); }}
                      aria-expanded={isOpen}
                      style={{ cursor: hasDetails ? "pointer" : "default" }}
                    >
                      <span className="spd-row-header-line">
                        <span className="spd-row-name">
                          <GroupLabel text={name} />
                          {hasDetails && (
                            <span className={`group-accordion-chevron${isOpen ? " open" : ""}`} aria-hidden="true">
                              <ChevronDownIcon />
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                    <div className="spd-row-right">
                      <span className="spd-row-ts" title={timestamp}>
                        <span className="spd-row-ts-icon" aria-hidden="true"><ClockIcon /></span>
                        <span className="swipe-x">{timestamp}</span>
                      </span>
                      <span className="spd-row-right-meta">
                        <span className={`status-badge ${chip.tone}`}>
                          {chip.icon}
                          {chip.label}
                        </span>
                        <span className="spd-row-score">{total !== "—" ? `${total}` : "—"}</span>
                      </span>
                    </div>
                  </div>

                  {hasDetails && (
                    <div className={`group-accordion-panel${isOpen ? " open" : ""}`}>
                      <div className="group-accordion-panel-inner spd-row-details">
                        {p.project_title && (
                          <div className="spd-detail">
                            <ProjectTitle text={p.project_title} />
                          </div>
                        )}
                        {students.length > 0 && (
                          <div className="spd-detail">
                            <StudentNames names={students} />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="premium-info-strip spd-empty">
              <span className="info-strip-icon" aria-hidden="true">
                <InfoIcon />
              </span>
              <span>No saved evaluations were found. You can start a new evaluation below.</span>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="spd-actions">
          <button className="premium-btn-primary" onClick={hasData ? onConfirm : onFresh}>
            {!allSubmitted && (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-arrow-right-from-line-icon lucide-arrow-right-from-line" aria-hidden="true">
                <path d="M3 5v14"/>
                <path d="M21 12H7"/>
                <path d="m15 18 6-6-6-6"/>
              </svg>
            )}
            {allSubmitted && editAllowed && (
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-pencil-icon lucide-pencil" aria-hidden="true"><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/></svg>
            )}
            {allSubmitted
              ? (editAllowed ? "Edit My Scores" : "Done")
              : hasData ? "Resume Evaluation" : " Start Evaluation"}
          </button>
        </div>

          </div>
        </div>
      )}
    </>
  );
}
