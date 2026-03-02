// src/jury/SheetsProgressDialog.jsx
// ============================================================
// Modal dialog shown after PIN verification.
//
// Always displayed — Sheets is the master source of truth.
// Shows how many groups have data in the sheet and lets the
// juror decide whether to:
//   • Continue  — load sheet data into the form
//   • Start Fresh — ignore sheet data, start with empty form
//
// Props:
//   progress  { rows, filledCount, totalCount, allSubmitted }
//   onConfirm () → load sheet data and proceed
//   onFresh   () → ignore sheet data and proceed
// ============================================================

import { useState } from "react";
import { PROJECTS } from "../config";
import {
  BadgeCheckIcon,
  ClipboardIcon,
  SaveIcon,
  ChevronDownIcon,
  CheckIcon,
  HourglassIcon,
  PencilIcon,
  ClockIcon,
  InfoIcon,
  BadgeInfoIcon,
  CircleIcon,
} from "../shared/Icons";
import MinimalLoaderOverlay from "../shared/MinimalLoaderOverlay";
import { formatTs as formatShortTs } from "../admin/utils";

// Status label + colour for each row returned by myscores.
function rowStatusChip(status) {
  if (status === "all_submitted")   return { label: "Submitted", tone: "submitted", icon: <CheckIcon /> };
  if (status === "group_submitted") return { label: "Submitted", tone: "submitted", icon: <CheckIcon /> };
  if (status === "in_progress")     return { label: "In Progress", tone: "in-progress", icon: <HourglassIcon /> };
  return { label: "Not started", tone: "not-started", icon: <CircleIcon /> };
}

export default function SheetsProgressDialog({ progress, onConfirm, onFresh }) {
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
              {allSubmitted ? <BadgeCheckIcon /> : hasData ? <SaveIcon /> : <ClipboardIcon />}
            </div>
            <div className="spd-header-main">
            <div className="spd-title" title={allSubmitted
              ? "All evaluations submitted"
              : hasData
              ? "Saved progress found"
              : "No saved data found"}>
              {allSubmitted
                ? "All evaluations submitted"
                : hasData
                ? "Saved progress found"
                : "No saved data found"}
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
            PROJECTS.map((p) => {
              const row = rows.find((r) => Number(r.projectId) === p.id);
              const chip = rowStatusChip(row?.status);
              const total = row?.total ?? "—";
              const timestamp = formatShortTs(row?.timestamp || "—");
              const isOpen = openGroup === p.id;

              return (
                <div key={p.id} className="spd-row-wrap">
                  <div className="spd-row">
                    <button
                      className="spd-row-left group-accordion-header"
                      type="button"
                      onClick={() => toggleGroup(p.id)}
                      aria-expanded={isOpen}
                    >
                      <span className="spd-row-header-line">
                        <span className="spd-row-icon" aria-hidden="true">
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-folder-kanban-icon lucide-folder-kanban"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><path d="M8 10v4"/><path d="M12 10v2"/><path d="M16 10v6"/></svg>
                        </span>
                        <span className="spd-row-name swipe-x" title={p.name}>{p.name}</span>
                        <span className={`group-accordion-chevron${isOpen ? " open" : ""}`} aria-hidden="true">
                          <ChevronDownIcon />
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

                  <div className={`group-accordion-panel${isOpen ? " open" : ""}`}>
                    <div className="group-accordion-panel-inner spd-row-details">
                      {p.desc && (
                        <div className="spd-detail">
                          <span className="spd-detail-icon" aria-hidden="true"><BadgeInfoIcon /></span>
                          <span className="spd-detail-text swipe-x">{p.desc}</span>
                        </div>
                      )}
                      {p.students?.length > 0 && (
                        <div className="spd-detail">
                          <span className="spd-detail-icon" aria-hidden="true">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-users-round-icon lucide-users-round"><path d="M18 21a8 8 0 0 0-16 0"/><circle cx="10" cy="8" r="5"/><path d="M22 20c0-3.37-2-6.5-4-8a5 5 0 0 0-.45-8.3"/></svg>
                          </span>
                          <span className="spd-detail-text swipe-x">{p.students.join(" · ")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="premium-info-strip spd-empty">
              <span className="info-strip-icon" aria-hidden="true">
                <InfoIcon />
              </span>
              <span>No evaluations were found on the server for your account. You can start a fresh evaluation below.</span>
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
              : hasData ? "Resume Editing" : "Start Fresh"}
          </button>
        </div>

          </div>
        </div>
      )}
    </>
  );
}
