// src/admin/CompletionStrip.jsx
// Persistent progress bar shown below the tab bar across all admin tabs.
// Receives statusMetrics from AdminPanel and computes display values internally.

export default function CompletionStrip({ metrics }) {
  if (!metrics) return null;

  const { completedJurors, totalJurors } = metrics;
  const safeTJ  = Math.max(1, totalJurors || 0);
  const safeCJ  = Math.min(Math.max(0, completedJurors || 0), safeTJ);
  const pct     = Math.round((safeCJ / safeTJ) * 100);
  const pending = totalJurors - safeCJ;

  return (
    <div className="completion-strip">
      <div className="completion-bar-wrap">
        <div
          className="completion-bar-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="completion-text">
        {safeCJ} of {totalJurors} jurors completed
        {pending > 0 && ` — ${pending} pending`}
      </span>
    </div>
  );
}
