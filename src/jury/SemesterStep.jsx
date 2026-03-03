// src/jury/SemesterStep.jsx
// ============================================================
// Semester selection step.
// Shown between PIN login and project evaluation.
//
// Auto-advances (via useEffect) when exactly one active
// semester exists — the user never sees this screen in that case.
//
// Props:
//   semesters  : [{ id, code, name, is_active, starts_on, ends_on }]
//   onSelect   : (semester) => void
//   onBack     : () => void
// ============================================================

import { useEffect } from "react";
import { ClockIcon } from "../shared/Icons";

export default function SemesterStep({ semesters, onSelect, onBack }) {
  // Auto-select when there is exactly one active semester.
  useEffect(() => {
    if (semesters.length === 0) return;
    const active = semesters.filter((s) => s.is_active);
    if (active.length === 1) onSelect(active[0]);
  }, [semesters]); // eslint-disable-line react-hooks/exhaustive-deps

  if (semesters.length === 0) {
    return (
      <div className="premium-screen">
        <div className="premium-card">
          <div className="premium-header">
            <div className="premium-icon-square" aria-hidden="true">
              <ClockIcon />
            </div>
            <div className="premium-title">No Semesters Available</div>
            <div className="premium-subtitle">Please contact the administrator.</div>
          </div>
          <button className="premium-btn-link" type="button" onClick={onBack}>
            ← Back to Home
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="premium-screen">
      <div className="premium-card">
        <div className="premium-header">
          <div className="premium-icon-square" aria-hidden="true">
            <ClockIcon />
          </div>
          <div className="premium-title">Select Semester</div>
          <div className="premium-subtitle">Choose the evaluation period to continue.</div>
        </div>

        <div className="info-form" style={{ gap: 10 }}>
          {semesters.map((s) => (
            <button
              key={s.id}
              className={s.is_active ? "premium-btn-primary" : "premium-btn-secondary"}
              type="button"
              onClick={() => onSelect(s)}
            >
              {s.name}
              {s.is_active && (
                <span style={{ marginLeft: 8, opacity: 0.75, fontSize: "0.8em" }}>
                  (Active)
                </span>
              )}
            </button>
          ))}
        </div>

        <button className="premium-btn-link" type="button" onClick={onBack}>
          ← Back to Home
        </button>
      </div>
    </div>
  );
}
