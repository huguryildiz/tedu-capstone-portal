// src/admin/ManagePermissionsPanel.jsx

import { useEffect, useState } from "react";
import { ChevronDownIcon, FolderLockIcon, SearchIcon } from "../shared/Icons";
import LastActivity from "./LastActivity";

export default function ManagePermissionsPanel({
  settings,
  jurors,
  isMobile,
  isOpen,
  onToggle,
  onSave,
  onToggleEdit,
}) {
  const [local, setLocal] = useState(settings);
  const [showAll, setShowAll] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  const handleEvalLockChange = (checked) => {
    const next = { ...local, evalLockActive: checked };
    setLocal(next);
    onSave?.(next);
  };
  const toBool = (v) => v === true || v === "true" || v === "t" || v === 1;
  const evalLockActive = toBool(local?.evalLockActive ?? settings?.evalLockActive);
  const orderedJurors = Array.isArray(jurors)
    ? [...jurors].sort((a, b) => {
        const aName = (a.juryName || a.juror_name || "").toLowerCase();
        const bName = (b.juryName || b.juror_name || "").toLowerCase();
        return aName.localeCompare(bName);
      })
    : [];
  const hasAssignedFlag = orderedJurors.some((j) =>
    j.isAssigned !== undefined && j.isAssigned !== null
    || j.is_assigned !== undefined && j.is_assigned !== null
  );
  const permissionJurors = hasAssignedFlag
    ? orderedJurors.filter((j) => toBool(j.isAssigned ?? j.is_assigned))
    : orderedJurors;
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredJurors = normalizedSearch
    ? permissionJurors.filter((j) => {
        const name = j.juryName || j.juror_name || "";
        const inst = j.juryDept || j.juror_inst || "";
        const haystack = `${name} ${inst}`.toLowerCase();
        return haystack.includes(normalizedSearch);
      })
    : permissionJurors;
  const visibleJurors = normalizedSearch
    ? filteredJurors
    : (showAll ? permissionJurors : permissionJurors.slice(0, 4));

  return (
    <div className={`manage-card${isMobile ? " is-collapsible" : ""}`}>
      <button
        type="button"
        className="manage-card-header"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <div className="manage-card-title">
          <span className="manage-card-icon" aria-hidden="true"><FolderLockIcon /></span>
          Evaluation Permissions
        </div>
        {isMobile && <ChevronDownIcon className={`manage-chevron${isOpen ? " open" : ""}`} />}
      </button>

      {(!isMobile || isOpen) && (
        <div className="manage-card-body">
          <div className="manage-card-desc">Toggle edit access per juror and lock evaluations for the active semester.</div>
          <div className="manage-field">
            <label className="manage-toggle">
              <span className="manage-toggle-text">Lock evaluations for the active semester</span>
              <span className="manage-toggle-control">
                <input
                  type="checkbox"
                  checked={local.evalLockActive}
                  onChange={(e) => handleEvalLockChange(e.target.checked)}
                />
                <span className="manage-toggle-track" />
              </span>
            </label>
          </div>

          <div className="manage-list">
            <div className="manage-search">
              <span className="manage-search-icon" aria-hidden="true"><SearchIcon /></span>
              <input
                className="manage-input manage-search-input"
                type="text"
                placeholder="Search jurors"
                aria-label="Search jurors"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            {visibleJurors.map((j) => {
              const jurorId = j.jurorId || j.juror_id;
              const totalProjects = Number(j.totalProjects ?? j.total_projects ?? 0);
              const completedProjects = Number(j.completedProjects ?? j.completed_projects ?? 0);
              const finalSubmittedAt = j.finalSubmittedAt ?? j.final_submitted_at ?? null;
              const isCompleted = Boolean(finalSubmittedAt);
              const isFullyComplete = totalProjects === 0 || completedProjects >= totalProjects;
              const completionHint = `Finalize submission first (${completedProjects}/${totalProjects})`;
              const disableHint = `Cannot disable edit mode until all scores are re-submitted (${completedProjects}/${totalProjects}).`;
              const editEnabled = toBool(j.editEnabled ?? j.edit_enabled);
              const lastActivityAt =
                j.lastSeenAt
                || j.last_seen_at
                || j.lastActivityAt
                || j.last_activity_at
                || "";
              const lockHint = evalLockActive
                ? "Evaluations are locked. Unlock to let jurors edit."
                : "";
              const baseTitle = editEnabled
                ? (!isFullyComplete ? disableHint : "")
                : (!isCompleted ? completionHint : "");
              const editTitle = [baseTitle, lockHint].filter(Boolean).join(" ");
              return (
                <div key={jurorId} className="manage-item">
                  <div>
                    <div className="manage-item-title">{j.juryName || j.juror_name}</div>
                    <div className="manage-item-sub">{j.juryDept || j.juror_inst}</div>
                    <div className="manage-item-meta">
                      <span className={`manage-item-completion${isCompleted ? " is-complete" : " is-incomplete"}`}>
                        {isCompleted
                          ? `Completed ${completedProjects}/${totalProjects}`
                          : `In progress ${completedProjects}/${totalProjects}`}
                      </span>
                      {!isCompleted && (
                        <span className="manage-item-helper is-warning">
                          {completionHint}
                        </span>
                      )}
                      {editEnabled && !isFullyComplete && (
                        <span className="manage-item-helper is-warning">
                          {disableHint}
                        </span>
                      )}
                      {evalLockActive && (
                        <span className="manage-item-helper is-warning">
                          {lockHint}
                        </span>
                      )}
                    </div>
                    <div className="manage-item-sub manage-meta-line">
                      <LastActivity value={lastActivityAt} />
                    </div>
                  </div>
                  <div className="manage-item-actions">
                    <div className="manage-toggle-wrap">
                      <span className="manage-toggle-label">Edit Mode</span>
                      <label className={`manage-switch${(editEnabled ? isFullyComplete : isCompleted) ? " is-ready" : " is-locked"}`}>
                        <input
                          type="checkbox"
                          checked={editEnabled}
                          disabled={editEnabled ? !isFullyComplete : !isCompleted}
                          title={editTitle}
                          onChange={(e) => {
                            if (editEnabled ? !isFullyComplete : !isCompleted) return;
                            onToggleEdit?.({
                              jurorId: j.jurorId || j.juror_id,
                              enabled: e.target.checked,
                            });
                          }}
                        />
                        <span className="manage-switch-slider" />
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
            {!normalizedSearch && permissionJurors.length === 0 && (
              <div className="manage-empty">No jurors assigned to the active semester.</div>
            )}
            {normalizedSearch && filteredJurors.length === 0 && (
              <div className="manage-empty manage-empty-search">No results.</div>
            )}
          </div>

          {!normalizedSearch && permissionJurors.length > 4 && (
            <button
              className="manage-btn ghost"
              type="button"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Show fewer jurors" : `Show all jurors (${permissionJurors.length})`}
            </button>
          )}

        </div>
      )}
    </div>
  );
}
