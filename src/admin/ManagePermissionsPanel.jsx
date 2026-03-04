// src/admin/ManagePermissionsPanel.jsx

import { useEffect, useState } from "react";
import { ChevronDownIcon, FolderLockIcon } from "../shared/Icons";

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

  useEffect(() => {
    setLocal(settings);
  }, [settings]);

  const handleEvalLockChange = (checked) => {
    const next = { ...local, evalLockActive: checked };
    setLocal(next);
    onSave?.(next);
  };
  const toBool = (v) => v === true || v === "true" || v === "t" || v === 1;
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
            {(showAll ? permissionJurors : permissionJurors.slice(0, 4)).map((j) => {
              const totalProjects = Number(j.totalProjects ?? j.total_projects ?? 0);
              const completedProjects = Number(j.completedProjects ?? j.completed_projects ?? 0);
              const isCompleted = totalProjects > 0 && completedProjects >= totalProjects;
              const completionHint = `Finish evaluations first (${completedProjects}/${totalProjects})`;
              const editEnabled = toBool(j.editEnabled ?? j.edit_enabled);
              return (
                <div key={j.jurorId || j.juror_id} className="manage-item">
                  <div>
                    <div className="manage-item-title">{j.juryName || j.juror_name}</div>
                    <div className="manage-item-sub">{j.juryDept || j.juror_inst}</div>
                    <div className="manage-item-meta">
                      <span className={`manage-item-completion${isCompleted ? " is-complete" : " is-incomplete"}`}>
                        Completed {completedProjects}/{totalProjects}
                      </span>
                      {!isCompleted && (
                        <span className="manage-item-helper is-warning">
                          {completionHint}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="manage-item-actions">
                    <div className="manage-toggle-wrap">
                      <span className="manage-toggle-label">Edit Mode</span>
                      <label className={`manage-switch${isCompleted ? " is-ready" : " is-locked"}`}>
                        <input
                          type="checkbox"
                          checked={editEnabled}
                          disabled={!isCompleted}
                          title={!isCompleted ? completionHint : ""}
                          onChange={(e) => {
                            if (!isCompleted) return;
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
            {permissionJurors.length === 0 && (
              <div className="manage-empty">No jurors assigned to the active semester.</div>
            )}
          </div>

          {permissionJurors.length > 4 && (
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
