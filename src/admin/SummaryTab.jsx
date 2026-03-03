// src/admin/SummaryTab.jsx
// ── Ranking summary with medal badges ──

import { useState } from "react";
import { APP_CONFIG, CRITERIA } from "../config";
import { InfoIcon, UsersRoundIcon, ChevronDownIcon, FolderKanbanIcon } from "../shared/Icons";
import medalFirst from "../assets/1st-place-medal.svg";
import medalSecond from "../assets/2nd-place-medal.svg";
import medalThird from "../assets/3rd-place-medal.svg";

const CRITERIA_LIST = CRITERIA.map((c) => ({ id: c.id, label: c.label, shortLabel: c.shortLabel, max: c.max }));
const MEDALS = [medalFirst, medalSecond, medalThird];

export default function SummaryTab({ ranked, submittedData }) {
  const [expandedGroups, setExpandedGroups] = useState(new Set());

  function toggleGroup(groupKey) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey);
      return next;
    });
  }

  if (submittedData.length === 0) {
    return <div className="empty-msg">No submitted evaluations yet.</div>;
  }

  return (
    <div className="summary-page">
      <div className="summary-note">
        <InfoIcon />
        <span className="summary-note-text">Scores reflect the average (Σ) of completed evaluations.</span>
      </div>
      <div className="rank-list">
        {ranked.map((p, i) => {
          const groupLabel = `Group ${p.groupNo}`;
          const projectTitle = (p.name || "").trim();
          const showTitle = !!projectTitle && projectTitle !== groupLabel;
          const studentList = p.students
            ? p.students.split(",").map((s) => s.trim()).filter(Boolean)
            : [];
          const hasDetails = showTitle || (APP_CONFIG.showStudents && studentList.length > 0);
          const groupKey = `summary-${p.id}-${i}`;
          const isExpanded = expandedGroups.has(groupKey);
          const isTop3 = i < 3;
          const panelId = `summary-group-panel-${groupKey}`;

          return (
            <div
              key={p.id}
              className={`rank-card rank-${i + 1} ${isTop3 ? `rank-top${i + 1}` : "rank-rest"}`}
            >
              {isTop3 && (
                <span className={`rank-accent rank-${i + 1}`} aria-hidden="true" />
              )}
              {isTop3 ? (
                <div className={`rank-badge rank-medal-wrap rank-${i + 1}`} aria-hidden="true">
                  <span className="rank-medal-ring" aria-hidden="true" />
                  <img className="rank-medal" src={MEDALS[i]} alt={`${i + 1} place medal`} />
                </div>
              ) : (
                <div className="rank-badge rank-num">{i + 1}</div>
              )}

              <div className="rank-info">
                <div className="group-card-wrap">
                  <div className="group-card-header">
                    <div className="group-card-left">
                      <button
                        className="group-card-toggle group-accordion-header"
                        tabIndex={hasDetails ? 0 : -1}
                        aria-expanded={hasDetails ? isExpanded : undefined}
                        aria-controls={hasDetails ? panelId : undefined}
                        type="button"
                        onClick={() => { if (hasDetails) toggleGroup(groupKey); }}
                        onKeyDown={(e) => {
                          if ((e.key === "Enter" || e.key === " ") && hasDetails) {
                            e.preventDefault();
                            toggleGroup(groupKey);
                          }
                        }}
                        style={{ cursor: hasDetails ? "pointer" : "default" }}
                      >
                        <span className="group-card-name">
                          <span className="group-card-name-icon" aria-hidden="true"><FolderKanbanIcon /></span>
                          <span className="group-card-name-text">{groupLabel}</span>
                        </span>
                        {hasDetails && (
                          <span className={`group-accordion-chevron${isExpanded ? " open" : ""}`}>
                            <ChevronDownIcon />
                          </span>
                        )}
                      </button>
                    </div>
                    <div className="group-card-score">
                      <small className="group-card-score-label sigma">Σ</small>
                      <span className="group-card-score-value avg-score">
                        {p.totalAvg.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div
                    id={panelId}
                    className={`group-accordion-panel${isExpanded ? " open" : ""}`}
                  >
                    <div className="group-accordion-panel-inner group-card-accordion-inner">
                      {showTitle && (
                        <div className="group-card-full-title">{projectTitle}</div>
                      )}
                      {APP_CONFIG.showStudents && studentList.length > 0 && (
                        <div className="group-card-students">
                          <span className="group-card-students-icon" aria-hidden="true"><UsersRoundIcon /></span>
                          <span className="group-card-students-text">{studentList.join(" · ")}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rank-bars">
                  {CRITERIA_LIST.map((c) => (
                    <div key={c.id} className="mini-bar-row">
                      <span className="mini-label">{c.shortLabel || c.label}</span>
                      <div className="mini-bar-track">
                        <div className="mini-bar-fill" style={{ width: `${((p.avg[c.id] || 0) / c.max) * 100}%` }} />
                      </div>
                      <span className="mini-val">{(p.avg[c.id] || 0).toFixed(2)}</span>
                    </div>
                  ))}
                </div>

              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
