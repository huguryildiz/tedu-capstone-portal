// src/jury/DoneStep.jsx
// ============================================================
// Step 4 — Confirmation / thank-you screen.
// Shows the submitted scores per group.
// Receives `projects` as a prop (dynamic from DB).
// ============================================================

import { useState } from "react";
import { CRITERIA } from "../config";
import { HomeIcon, ChevronDownIcon, CheckIcon, UsersRoundIcon, PencilIcon } from "../shared/Icons";

function groupTotal(scores, pid) {
  return CRITERIA.reduce((s, c) => s + (parseInt(scores[pid]?.[c.id], 10) || 0), 0);
}

export default function DoneStep({
  juryName,
  doneScores,
  scores,
  projects,
  onBack,
  onEditScores,
}) {
  const displayScores = doneScores || scores;
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  function toggleGroup(pid) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(pid) ? next.delete(pid) : next.add(pid);
      return next;
    });
  }

  return (
    <div className="premium-screen">
      <div className="premium-card">
        <div className="premium-header">
          <div className="premium-icon-square confetti-icon" aria-hidden="true">
            <span className="confetti-burst confetti-a" />
            <span className="confetti-burst confetti-b" />
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-party-popper"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/></svg>
          </div>
          <div className="premium-title">Thank You{juryName ? `, ${juryName}` : ""}!</div>
          <div className="premium-subtitle done-subtitle">
            <span>Your evaluations have been submitted.</span>
          </div>
        </div>

        <div className="done-summary spd-list">
          {(projects || []).map((p) => {
            const pid        = p.project_id;
            const isExpanded = expandedGroups.has(pid);
            const panelId    = `done-group-panel-${pid}`;
            const totalScore = groupTotal(displayScores, pid);
            const studentList = p.group_students
              ? p.group_students.split(",").map((s) => s.trim()).filter(Boolean)
              : [];
            const hasDetails = studentList.length > 0;

            return (
              <div key={pid} className="spd-row-wrap">
                <div className="spd-row">
                  <button
                    className="spd-row-left group-accordion-header"
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                    onClick={() => { if (hasDetails) toggleGroup(pid); }}
                    style={{ cursor: hasDetails ? "pointer" : "default" }}
                  >
                    <div className="spd-row-header-line">
                      <span className="spd-row-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><path d="M8 10v4"/><path d="M12 10v2"/><path d="M16 10v6"/></svg>
                      </span>
                      <span className="spd-row-name swipe-x">
                        Group {p.group_no} — {p.project_title}
                      </span>
                      {hasDetails && (
                        <span className={`group-accordion-chevron${isExpanded ? " open" : ""}`}>
                          <ChevronDownIcon />
                        </span>
                      )}
                    </div>
                  </button>
                  <div className="spd-row-right">
                    <span className="spd-row-right-meta">
                      <span className="status-badge submitted">
                        <CheckIcon />
                        Submitted
                      </span>
                      <span className="spd-row-score">{String(totalScore)}</span>
                    </span>
                  </div>
                </div>

                {hasDetails && (
                  <div id={panelId} className={`group-accordion-panel${isExpanded ? " open" : ""}`}>
                    <div className="group-accordion-panel-inner spd-row-details">
                      <div className="spd-detail">
                        <span className="spd-detail-icon" aria-hidden="true"><UsersRoundIcon /></span>
                        <span className="spd-detail-text swipe-x">{studentList.join(" · ")}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="done-actions">
          {onEditScores && (
            <button className="premium-btn-secondary" onClick={onEditScores} type="button">
              <PencilIcon />
              Edit My Scores
            </button>
          )}
          <button className="premium-btn-primary" onClick={onBack} type="button">
            <HomeIcon /> Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
