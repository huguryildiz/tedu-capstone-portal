// src/jury/InfoStep.jsx
// ============================================================
// Step 1 — Juror identity form.
//
// The juror enters their name and department, then clicks
// "Start Evaluation". All cloud-state feedback (saved progress,
// already submitted) is handled by SheetsProgressDialog which
// is rendered as an overlay in JuryForm after PIN verification.
//
// This component is intentionally simple: it collects identity
// and delegates everything else downstream.
// ============================================================

import { InfoIcon, UserRoundCheckIcon } from "../shared/Icons";

export default function InfoStep({
  juryName, setJuryName,
  juryDept, setJuryDept,
  onStart,
  onBack,
}) {
  const canStart = juryName.trim().length > 0 && juryDept.trim().length > 0;

  return (
    <div className="premium-screen">
      <div className="premium-card">
        <div className="premium-header">
          <div className="premium-icon-square" aria-hidden="true"><UserRoundCheckIcon /></div>
          <div className="premium-title">Jury Information</div>
          <div className="premium-subtitle">EE 492 — Senior Project Evaluation</div>
        </div>

        <div className="premium-info-strip">
          <span className="info-strip-icon" aria-hidden="true"><InfoIcon /></span>
          <span>Your information cannot be changed after you begin.</span>
        </div>

        <div className="info-form">
          <div className="field">
            <label htmlFor="jury-name">Full Name <span className="req">*</span></label>
            <input
              id="jury-name"
              value={juryName}
              onChange={(e) => setJuryName(e.target.value)}
              placeholder="e.g. Prof. Dr. Jane Smith"
              autoComplete="name"
              autoFocus
              className="premium-input"
            />
          </div>

          <div className="field">
            <label htmlFor="jury-dept">Department or Institution <span className="req">*</span></label>
            <input
              id="jury-dept"
              value={juryDept}
              onChange={(e) => setJuryDept(e.target.value)}
              placeholder="e.g. EEE Dept. / TED University"
              onKeyDown={(e) => { if (e.key === "Enter" && canStart) onStart(); }}
              className="premium-input"
            />
          </div>
        </div>

        <button
          className="premium-btn-primary"
          disabled={!canStart}
          onClick={onStart}
        >
          Start Evaluation →
        </button>
        <button className="premium-btn-link" onClick={onBack} type="button">
          <span aria-hidden="true">←</span>
          Back to Home
        </button>
      </div>
    </div>
  );
}
