// src/jury/EvalStep.jsx
// ============================================================
// Step 3 — Scoring form.
//
// Receives `projects` as a prop (dynamic from DB).
// Score state is keyed by project.project_id (UUID).
//
// Header (sticky, 4 rows):
//   Row 1: Juror identity + save status
//   Row 2: [Home btn]  [Group info card]
//   Row 3: [← Prev]  [Group dropdown]  [Next →]
//   Row 4: Progress bar
//
// Write strategy:
//   - Score onChange  → state only, no write
//   - Score onBlur    → clamp + writeGroup(pid)
//   - Comment onChange → state only, no write
//   - Comment onBlur  → writeGroup(pid)
//   - Navigation      → writeGroup(currentPid) then navigate
// ============================================================

import { useState, useEffect, useRef } from "react";
import { CRITERIA, APP_CONFIG } from "../config";
import { countFilled, isScoreFilled } from "./useJuryState";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  HomeIcon,
  UserCheckIcon,
  FolderKanbanIcon,
  UsersRoundIcon,
  CheckCircle2Icon,
  CheckIcon,
  HourglassIcon,
  CircleIcon,
  PencilIcon,
  TriangleAlertIcon,
} from "../shared/Icons";
import LevelPill from "../shared/LevelPill";

function progressGradient(pct) {
  if (pct === 0)   return "#e2e8f0";
  if (pct <= 33)   return "#f97316";
  if (pct <= 66)   return "#eab308";
  if (pct < 100)   return "#84cc16";
  return "#22c55e";
}

function SaveIndicator({ saveStatus }) {
  if (saveStatus === "saving") {
    return (
      <span className="autosave-dot saving">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"/>
          <g className="autosave-arrow">
            <path d="M12 13v8"/>
            <path d="m8 17 4-4 4 4"/>
          </g>
        </svg>
        Saving…
      </span>
    );
  }
  if (saveStatus === "saved") {
    return (
      <span className="autosave-dot saved">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m17 15-5.5 5.5L9 18"/>
          <path d="M5.516 16.07A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 3.501 7.327"/>
        </svg>
        Saved
      </span>
    );
  }
  return (
    <span className="autosave-dot idle">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
      </svg>
    </span>
  );
}

export default function EvalStep({
  juryName, juryDept,
  projects,
  current, onNavigate,
  scores, comments, touched,
  groupSynced, editMode,
  progressPct, allComplete,
  saveStatus,
  handleScore, handleScoreBlur,
  handleCommentChange, handleCommentBlur,
  handleFinalSubmit,
  onGoHome,
}) {
  const [showBackMenu,    setShowBackMenu]    = useState(false);
  const [openRubric,      setOpenRubric]      = useState(null);
  const [groupInfoOpen,   setGroupInfoOpen]   = useState(false);
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const scrollRef = useRef(null);

  const project = projects[current];

  // Reset group info on project change
  useEffect(() => { setGroupInfoOpen(false); }, [current]);

  // Sticky header collapse on mobile scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      if (window.innerWidth > 1024) { setHeaderCollapsed(false); return; }
      const y = el.scrollTop;
      setHeaderCollapsed((prev) => {
        if (!prev && y > 80) return true;
        if (prev && y < 30) return false;
        return prev;
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  if (!project) return null;

  const pid = project.project_id;

  const currentFilled = CRITERIA.filter((c) => isScoreFilled(scores[pid]?.[c.id])).length;
  const currentTotal  = CRITERIA.length;
  const groupPillStatus =
    currentFilled >= currentTotal ? "complete" : currentFilled > 0 ? "progress" : "empty";

  const totalScore = CRITERIA.reduce(
    (s, c) => s + (parseInt(scores[pid]?.[c.id], 10) || 0),
    0
  );

  const groupLabel = (p) => {
    const ppid   = p.project_id;
    const filled = CRITERIA.reduce(
      (acc, c) => {
        const v = scores[ppid]?.[c.id];
        return v === "" || v == null ? acc : acc + 1;
      },
      0
    );
    const total = CRITERIA.length;
    const ratio = `(${filled}/${total})`;
    const name  = `Group ${p.group_no}`;
    if (filled === total && total > 0) return `✅ ${name} ${ratio}`;
    if (filled > 0)                    return `⚠️ ${name} ${ratio}`;
    return `${name} ${ratio}`;
  };

  // Parse students: DB stores as a single text string (comma-separated)
  const studentList = project.group_students
    ? project.group_students.split(",").map((s) => s.trim()).filter(Boolean)
    : [];

  const goPrev = () => { if (current > 0) onNavigate(current - 1); };
  const goNext = () => { if (current < projects.length - 1) onNavigate(current + 1); };

  return (
    <div className="eval-screen">
      <div className="eval-card">
        <div className="eval-scroll" ref={scrollRef}>

      {/* ── Sticky header ── */}
      <div className={`eval-sticky-header${headerCollapsed ? " is-collapsed" : ""}`}>

        {/* Row 1: Juror name (Dept) · autosave · HOME icon */}
        <div className="eval-identity-bar">
          <div className="eval-identity-left">
            <span className="eval-identity-icon" aria-hidden="true"><UserCheckIcon /></span>
            <span className="eval-identity-text eval-scroll-line">
              {juryName}
              {juryDept && <span className="eval-identity-dept"> ({juryDept})</span>}
            </span>
          </div>
          <div className="eval-identity-actions">
            <span className="eval-identity-save">
              <SaveIndicator saveStatus={saveStatus} />
            </span>
            <span className="eval-identity-sep" aria-hidden="true">·</span>
            <button
              className="eval-home-btn-icon"
              onClick={() => setShowBackMenu(true)}
              aria-label="Home"
            >
              <HomeIcon />
            </button>
          </div>
        </div>

        {/* Row 2: Group info (collapsible, hides on scroll on mobile) */}
        <div className={`eval-project-card-wrap${headerCollapsed ? " collapsed" : ""}`}>
          <div className={`eval-project-card${groupInfoOpen ? " is-open" : ""}`}>
            <div className="eval-project-summary">
              <span className="eval-project-icon" aria-hidden="true"><FolderKanbanIcon /></span>
              <span className="eval-group-label eval-scroll-line">
                Group {project.group_no} — {project.project_title}
              </span>
              <button
                className="eval-project-toggle"
                type="button"
                aria-expanded={groupInfoOpen}
                aria-label={groupInfoOpen ? "Collapse group details" : "Expand group details"}
                onClick={() => setGroupInfoOpen((v) => !v)}
              >
                <ChevronDownIcon />
              </button>
              <span className={`eval-status-pill ${groupPillStatus} eval-group-pill`}>
                {groupPillStatus === "complete" && <CheckIcon />}
                {groupPillStatus === "progress" && <HourglassIcon />}
                {groupPillStatus === "empty"    && <CircleIcon />}
                {currentFilled}/{currentTotal}
              </span>
            </div>
            <div className="eval-project-details">
              {APP_CONFIG.showStudents && studentList.length > 0 && (
                <div className="eval-project-detail">
                  <span className="eval-project-detail-icon" aria-hidden="true"><UsersRoundIcon /></span>
                  <span className="eval-project-detail-text eval-scroll-line">
                    {studentList.join(" · ")}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Row 3: Prev · Dropdown · Next */}
        <div className="eval-nav-row">
          <button
            className="group-nav-btn"
            onClick={goPrev}
            disabled={current === 0}
            aria-label="Previous group"
          >
            <ChevronLeftIcon />
          </button>
          <div className="group-nav-center">
            <select
              className="group-nav-select"
              value={current}
              onChange={(e) => onNavigate(Number(e.target.value))}
            >
              {projects.map((p, i) => (
                <option key={p.project_id} value={i}>{groupLabel(p)}</option>
              ))}
            </select>
          </div>
          <button
            className="group-nav-btn"
            onClick={goNext}
            disabled={current === projects.length - 1}
            aria-label="Next group"
          >
            <ChevronRightIcon />
          </button>
        </div>

        {/* Row 4: Progress bar */}
        <div className="eval-progress-row">
          <div className="eval-progress-bar-bg">
            <div
              className="eval-progress-bar-fill"
              style={{ width: `${progressPct}%`, background: progressGradient(progressPct) }}
            />
          </div>
          <span className="eval-progress-label">{Math.round(progressPct)}%</span>
        </div>

      </div>

      {/* ── Body ── */}
      <div className="eval-body">

        {groupSynced[pid] && !editMode && (
          <div className="group-done-banner">
            <CheckCircle2Icon />
            All scores saved for this group.
          </div>
        )}
        {editMode && (
          <div className="group-done-banner edit-mode-banner">
            <PencilIcon />
            Edit mode — adjust scores then click Submit Final.
          </div>
        )}

        {/* Criterion cards */}
        {CRITERIA.map((crit) => {
          const val         = scores[pid]?.[crit.id] ?? "";
          const showMissing = touched[pid]?.[crit.id] && (val === "" || val == null);
          const barPct      = ((parseInt(val, 10) || 0) / crit.max) * 100;

          return (
            <div key={crit.id} className={`crit-card${showMissing ? " invalid" : ""}`}>
              <div className="crit-header">
                <div>
                  <div className="crit-label">{crit.label}</div>
                  <div className="crit-max">Maximum: {crit.max} pts</div>
                </div>
                <button
                  className="rubric-btn"
                  onClick={() => setOpenRubric(openRubric === crit.id ? null : crit.id)}
                >
                  Rubric
                  <span className={`rubric-chevron${openRubric === crit.id ? " open" : ""}`}>
                    <ChevronDownIcon />
                  </span>
                </button>
              </div>

              {openRubric === crit.id && (
                <div className="rubric-table">
                  {crit.rubric.map((r) => (
                    <div key={r.range} className="rubric-row">
                      <div className="rubric-range">{r.range}</div>
                      <LevelPill variant={r.level}>{r.level}</LevelPill>
                      <div className="rubric-desc">{r.desc}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="score-input-row">
                <input
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max={crit.max}
                  value={val}
                  onChange={(e) => handleScore(pid, crit.id, e.target.value)}
                  onBlur={()   => handleScoreBlur(pid, crit.id)}
                  placeholder="—"
                  className="score-input"
                />
                <span className="score-bar-wrap">
                  <span className="score-bar" style={{ width: `${barPct}%` }} />
                </span>
                <span className="score-pct">
                  {val !== "" && val != null ? `${val} / ${crit.max}` : `— / ${crit.max}`}
                </span>
              </div>

              {showMissing && (
                <div className="required-hint">
                  <TriangleAlertIcon />
                  Required
                </div>
              )}
            </div>
          );
        })}

        {/* Comments */}
        <div className="crit-card comment-card">
          <div className="crit-label">Comments (Optional)</div>
          <textarea
            value={comments[pid] || ""}
            onChange={(e) => handleCommentChange(pid, e.target.value)}
            onBlur={()    => handleCommentBlur(pid)}
            placeholder="Any additional feedback about this group…"
            rows={3}
          />
        </div>

        {/* Running total */}
        <div className="total-bar">
          <span className="total-label">Total</span>
          <span className={`total-score${totalScore >= 80 ? " high" : totalScore >= 60 ? " mid" : ""}`}>
            {totalScore} / 100
          </span>
        </div>

        {/* Submit All — non-edit mode, all filled */}
        {allComplete && !editMode && (
          <button
            className="premium-btn-primary eval-submit-btn"
            style={{ width: "100%", marginTop: 8 }}
            onClick={handleFinalSubmit}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z"/><path d="m21.854 2.147-10.94 10.939"/></svg>
            Submit All Evaluations
          </button>
        )}

        {/* Submit Final — edit mode only */}
        {editMode && (
          <button
            className="premium-btn-primary eval-submit-btn"
            style={{ width: "100%", marginTop: 8, opacity: allComplete ? 1 : 0.65 }}
            onClick={handleFinalSubmit}
          >
            {allComplete
              ? "Submit Final"
              : `Submit Final (${countFilled(scores, projects)} / ${projects.length * CRITERIA.length} filled)`}
          </button>
        )}

      </div>
      </div>
      </div>

      {/* ── Home confirmation overlay ── */}
      {showBackMenu && (
        <div className="back-menu-overlay" onClick={() => setShowBackMenu(false)}>
          <div className="back-menu" onClick={(e) => e.stopPropagation()}>
            <p className="back-menu-title">Leave evaluation?</p>
            <p className="back-menu-sub">Your progress is saved. You can continue any time.</p>
            <button
              className="back-menu-btn primary"
              onClick={() => { setShowBackMenu(false); onGoHome(); }}
            >
              <HomeIcon />
              Go to Home
            </button>
            <button
              className="back-menu-btn secondary"
              onClick={() => setShowBackMenu(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
