// src/components/admin/DeleteConfirmDialog.jsx

import { useEffect, useState } from "react";
import { TriangleAlertLucideIcon } from "../../shared/Icons";

function buildCountSummary(counts) {
  if (!counts) return null;
  const parts = [];
  if (counts.projects > 0) parts.push(`${counts.projects} project${counts.projects !== 1 ? "s" : ""}`);
  if (counts.scores > 0) parts.push(`${counts.scores} score${counts.scores !== 1 ? "s" : ""}`);
  if (counts.juror_auths > 0) parts.push(`${counts.juror_auths} juror assignment${counts.juror_auths !== 1 ? "s" : ""}`);
  if (parts.length === 0) return null;
  return `This will also permanently delete: ${parts.join(", ")}.`;
}

export default function DeleteConfirmDialog({
  open,
  onOpenChange,
  targetLabel,
  counts,
  onConfirm,
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPassword("");
    setError("");
    setLoading(false);
  }, [open]);

  if (!open) return null;
  const label = targetLabel || "Selected record";
  const semesterPrefix = "Semester ";
  const jurorPrefix = "Juror ";
  const groupPrefix = "Group ";
  const isSemesterLabel = label.startsWith(semesterPrefix) && label.length > semesterPrefix.length;
  const isJurorLabel = label.startsWith(jurorPrefix) && label.length > jurorPrefix.length;
  const isGroupLabel = label.startsWith(groupPrefix) && label.length > groupPrefix.length;

  const handleClose = () => {
    if (loading) return;
    onOpenChange?.(false);
  };

  const handleConfirm = async () => {
    const value = password.trim();
    if (!value) {
      setError("Delete password is required.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await onConfirm?.(value);
      onOpenChange?.(false);
    } catch (e) {
      setError(e?.message || "Could not delete. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="manage-modal" role="dialog" aria-modal="true">
      <div className="manage-modal-card">
        <div className="manage-modal-title manage-title-with-icon">
          <span className="manage-title-icon" aria-hidden="true"><TriangleAlertLucideIcon /></span>
          Delete Confirmation
        </div>
        <div className="manage-modal-body">
          <div className="manage-hint manage-hint-inline">
            {isSemesterLabel ? (
              <>
                {semesterPrefix}
                <strong className="manage-delete-focus">{label.slice(semesterPrefix.length)}</strong>
                {" will be deleted. Are you sure?"}
              </>
            ) : isJurorLabel ? (
              <>
                {jurorPrefix}
                <strong className="manage-delete-focus">{label.slice(jurorPrefix.length)}</strong>
                {" will be deleted. Are you sure?"}
              </>
            ) : isGroupLabel ? (
              <>
                <strong className="manage-delete-focus">{label}</strong>
                {" will be deleted. Are you sure?"}
              </>
            ) : (
              <>
                <strong className="manage-delete-focus">{label}</strong>
                {" will be deleted. Are you sure?"}
              </>
            )}
          </div>
          {buildCountSummary(counts) && (
            <div className="manage-hint manage-delete-impact">
              {buildCountSummary(counts)}
            </div>
          )}
          <div className="manage-hint">Enter the delete password to confirm.</div>
          <div className="manage-field">
            <label className="manage-label">Delete Password</label>
            <input
              type="password"
              className="manage-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
            {error && <div className="manage-field-error">{error}</div>}
          </div>
        </div>
        <div className="manage-modal-actions">
          <button className="manage-btn" type="button" onClick={handleClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="manage-btn danger"
            type="button"
            onClick={handleConfirm}
            disabled={!password.trim() || loading}
          >
            {loading ? "Deleting..." : "Delete"}
          </button>
        </div>
      </div>
    </div>
  );
}
