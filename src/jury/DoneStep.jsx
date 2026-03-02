// src/jury/DoneStep.jsx
// ============================================================
// Step 3 — Confirmation / thank-you screen.
// Shows the submitted scores per group with an option to edit.
// ============================================================

import { useState } from "react";
import { PROJECTS, CRITERIA } from "../config";
import { HomeIcon, ChevronDownIcon, CheckIcon, ClockIcon, BadgeInfoIcon } from "../shared/Icons";

function formatShortTs(raw) {
  if (!raw || raw === "—") return "—";
  const s = String(raw).trim();
  const storedSlash = /^(\d{2})\/(\d{2})\/(\d{4} \d{2}:\d{2})(?::\d{2})?$/.exec(s);
  if (storedSlash) return `${storedSlash[1]}.${storedSlash[2]}.${storedSlash[3]}`;
  const storedDot = /^(\d{2}\.\d{2}\.\d{4} \d{2}:\d{2})(?::\d{2})?$/.exec(s);
  if (storedDot) return storedDot[1];
  try {
    const d = new Date(s);
    if (isNaN(d.getTime())) return s;
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Istanbul",
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
      hour12: false,
    }).format(d).replace(",", "").replace(/\//g, ".");
  } catch {
    return s;
  }
}

function groupTotal(scores, pid) {
  return CRITERIA.reduce((s, c) => s + (parseInt(scores[pid]?.[c.id], 10) || 0), 0);
}

export default function DoneStep({
  doneScores,
  doneRows,
  scores,
  onBack,
}) {
  // Fall back to live scores if done-snapshots are null
  // (e.g. when navigating to done screen from the info page).
  const displayScores = doneScores || scores;
  const rows = doneRows || [];

  const [expandedGroups, setExpandedGroups] = useState(new Set());
  function toggleGroup(id) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
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
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-party-popper-icon lucide-party-popper"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/><path d="M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z"/></svg>
          </div>
          <div className="premium-title">Thank You!</div>
          <div className="premium-subtitle done-subtitle">
            <span>Your evaluations have been submitted.</span>
            <span>Further edits require administrative approval.</span>
          </div>
        </div>

        <div className="done-summary spd-list">
          {PROJECTS.map((p) => {
            const isExpanded = expandedGroups.has(p.id);
            const panelId = `done-group-panel-${p.id}`;
            const hasDetails = !!p.desc || p.students?.length > 0;
            const totalScore = groupTotal(displayScores, p.id);
            const row = rows.find((r) => Number(r.projectId) === p.id);
            const timestamp = formatShortTs(row?.timestamp || "—");
          return (
              <div key={p.id} className="spd-row-wrap">
                {/* Clickable header — always visible */}
                <div className="spd-row">
                  {/* LEFT: identity column */}
                  <button
                    className="spd-row-left group-accordion-header"
                    type="button"
                    aria-expanded={isExpanded}
                    aria-controls={panelId}
                    onClick={() => { if (hasDetails) toggleGroup(p.id); }}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" || e.key === " ") && hasDetails) {
                        e.preventDefault();
                        toggleGroup(p.id);
                      }
                    }}
                    style={{ cursor: hasDetails ? "pointer" : "default" }}
                  >
                    <div className="spd-row-header-line">
                      <span className="spd-row-icon" aria-hidden="true">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-folder-kanban-icon lucide-folder-kanban"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/><path d="M8 10v4"/><path d="M12 10v2"/><path d="M16 10v6"/></svg>
                      </span>
                      <span className="spd-row-name swipe-x" title={p.name}>{p.name}</span>
                      {hasDetails && (
                        <span className={`group-accordion-chevron${isExpanded ? " open" : ""}`}>
                          <ChevronDownIcon />
                        </span>
                      )}
                    </div>
                  </button>
                  {/* RIGHT: KPI stack */}
                  <div className="spd-row-right">
                    <span className="spd-row-ts" title={timestamp}>
                      <span className="spd-row-ts-icon" aria-hidden="true"><ClockIcon /></span>
                      <span className="swipe-x">{timestamp}</span>
                    </span>
                    <span className="spd-row-right-meta">
                      <span className="status-badge submitted">
                        <CheckIcon />
                        Submitted
                      </span>
                      <span className="spd-row-score">{String(totalScore)}</span>
                    </span>
                  </div>
                </div>

                {/* Expandable panel */}
                <div id={panelId} className={`group-accordion-panel${isExpanded ? " open" : ""}`}>
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
          })}
        </div>

        <div className="done-actions">
          <button className="premium-btn-primary" onClick={onBack}>
            <HomeIcon /> Back to Home
          </button>
        </div>
      </div>
    </div>
  );
}
