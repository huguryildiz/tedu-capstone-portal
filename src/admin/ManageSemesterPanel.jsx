// src/admin/ManageSemesterPanel.jsx

import { useState } from "react";
import { CheckCircle2Icon, PencilIcon } from "../shared/Icons";

export default function ManageSemesterPanel({
  semesters,
  activeSemesterId,
  isMobile,
  isOpen,
  onToggle,
  onSetActive,
  onCreateSemester,
  onUpdateSemester,
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [createForm, setCreateForm] = useState({ name: "", starts_on: "", ends_on: "" });
  const [editForm, setEditForm] = useState({ id: "", name: "", starts_on: "", ends_on: "" });

  const maxYear = 9999;
  const yearOf = (value) => {
    if (!value) return null;
    const [y] = String(value).split("-");
    const n = Number(y);
    return Number.isFinite(n) ? n : null;
  };
  const getFormMeta = (value) => {
    const startYear = yearOf(value.starts_on);
    const endYear = yearOf(value.ends_on);
    const yearError =
      (startYear && startYear > maxYear) || (endYear && endYear > maxYear)
        ? "Year cannot exceed 9999."
        : "";
    const dateError =
      value.starts_on && value.ends_on && value.starts_on > value.ends_on
        ? "Start date must be on or before end date."
        : "";
    const canSubmit =
      value.name.trim() && value.starts_on && value.ends_on && !dateError && !yearError;
    return { yearError, dateError, canSubmit };
  };
  const createMeta = getFormMeta(createForm);
  const editMeta = getFormMeta(editForm);

  const sortSemesters = (list) => {
    const termOrder = { summer: 2, spring: 1, fall: 0 };
    return [...list].sort((a, b) => {
      const aLabel = String(a.name || "");
      const bLabel = String(b.name || "");
      const aYear = Number(aLabel.match(/\d{4}/)?.[0] || 0);
      const bYear = Number(bLabel.match(/\d{4}/)?.[0] || 0);
      if (aYear !== bYear) return bYear - aYear;
      const aTerm = aLabel.toLowerCase();
      const bTerm = bLabel.toLowerCase();
      const aRank = aTerm.includes("spring")
        ? termOrder.spring
        : aTerm.includes("summer")
          ? termOrder.summer
          : aTerm.includes("fall")
            ? termOrder.fall
            : -1;
      const bRank = bTerm.includes("spring")
        ? termOrder.spring
        : bTerm.includes("summer")
          ? termOrder.summer
          : bTerm.includes("fall")
            ? termOrder.fall
            : -1;
      if (aRank !== bRank) return bRank - aRank;
      return aLabel.localeCompare(bLabel);
    });
  };

  const orderedSemesters = sortSemesters(semesters);
  const normalizeDateInput = (value) => {
    if (!value) return "";
    return String(value).slice(0, 10);
  };
  const formatDate = (value) => {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    const pad = (v) => String(v).padStart(2, "0");
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
  };

  return (
    <div className={`manage-card${isMobile ? " is-collapsible" : ""}`}>
      <button
        type="button"
        className="manage-card-header"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <div className="manage-card-title">
          <span className="manage-card-icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m15.228 16.852-.923-.383" />
              <path d="m15.228 19.148-.923.383" />
              <path d="M16 2v4" />
              <path d="m16.47 14.305.382.923" />
              <path d="m16.852 20.772-.383.924" />
              <path d="m19.148 15.228.383-.923" />
              <path d="m19.53 21.696-.382-.924" />
              <path d="m20.772 16.852.924-.383" />
              <path d="m20.772 19.148.924.383" />
              <path d="M21 10.592V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
              <path d="M3 10h18" />
              <path d="M8 2v4" />
              <circle cx="18" cy="18" r="3" />
            </svg>
          </span>
          Semester Management
        </div>
      </button>

      {isOpen && (
        <div className="manage-card-body">
          <div className="manage-card-desc">Set the active term and maintain semester dates.</div>
          <div className="manage-field">
            <label className="manage-label">Active Semester</label>
            <div className="manage-row">
              <select
                className="manage-select"
                value={activeSemesterId || ""}
                onChange={(e) => onSetActive(e.target.value)}
              >
                {orderedSemesters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="manage-list">
            <div className="manage-list-header">All Semesters</div>
            {(showAll ? orderedSemesters : orderedSemesters.slice(0, 4)).map((s) => (
              <div key={s.id} className="manage-item">
                <div>
                  <div className="manage-item-title">{s.name}</div>
                  <div className="manage-item-sub manage-meta-line">
                    <span className="manage-meta-icon manage-semester-date-icon" aria-hidden="true">
                      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M8 2v4" />
                        <path d="M16 2v4" />
                        <rect width="18" height="18" x="3" y="4" rx="2" />
                        <path d="M3 10h18" />
                        <path d="M8 14h.01" />
                        <path d="M12 14h.01" />
                        <path d="M16 14h.01" />
                        <path d="M8 18h.01" />
                        <path d="M12 18h.01" />
                        <path d="M16 18h.01" />
                      </svg>
                    </span>
                    <span>{formatDate(s.starts_on)} → {formatDate(s.ends_on)}</span>
                  </div>
                </div>
                <div className="manage-item-actions">
                  {s.is_active && (
                    <span className="manage-pill">
                      <CheckCircle2Icon /> ACTIVE
                    </span>
                  )}
                  <button
                    className="manage-icon-btn"
                    type="button"
                    title="Edit semester"
                    aria-label={`Edit ${s.name}`}
                    onClick={() => {
                      setEditForm({
                        id: s.id,
                        name: s.name || "",
                        starts_on: normalizeDateInput(s.starts_on),
                        ends_on: normalizeDateInput(s.ends_on),
                      });
                      setShowEdit(true);
                    }}
                  >
                    <PencilIcon />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {orderedSemesters.length > 4 && (
            <button
              className="manage-btn ghost"
              type="button"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Show fewer semesters" : `Show all semesters (${orderedSemesters.length})`}
            </button>
          )}

          <div className="manage-card-actions">
            <button className="manage-btn primary" type="button" onClick={() => setShowCreate(true)}>
              + Create Semester
            </button>
          </div>

          {showCreate && (
            <div className="manage-modal">
              <div className="manage-modal-card">
                <div className="manage-modal-title">Create Semester</div>
                <div className="manage-modal-body">
                  <label className="manage-label">Semester name</label>
                  <input
                    className="manage-input"
                    value={createForm.name}
                    onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="2026 Spring"
                  />
                  <div className="manage-inline">
                    <div className="manage-field">
                      <label className="manage-label">Start date</label>
                      <input
                        type="date"
                        className={`manage-input manage-date${createForm.starts_on ? "" : " is-empty"}`}
                        value={createForm.starts_on}
                        onChange={(e) => setCreateForm((f) => ({ ...f, starts_on: e.target.value }))}
                        max="9999-12-31"
                      />
                    </div>
                    <div className="manage-field">
                      <label className="manage-label">End date</label>
                      <input
                        type="date"
                        className={`manage-input manage-date${createForm.ends_on ? "" : " is-empty"}`}
                        value={createForm.ends_on}
                        onChange={(e) => setCreateForm((f) => ({ ...f, ends_on: e.target.value }))}
                        max="9999-12-31"
                      />
                    </div>
                  </div>
                  {createMeta.yearError && <div className="manage-field-error">{createMeta.yearError}</div>}
                  {createMeta.dateError && <div className="manage-field-error">{createMeta.dateError}</div>}
                </div>
                <div className="manage-modal-actions">
                  <button className="manage-btn" type="button" onClick={() => setShowCreate(false)}>
                    Cancel
                  </button>
                  <button
                    className="manage-btn primary"
                    type="button"
                    disabled={!createMeta.canSubmit}
                    onClick={() => {
                      onCreateSemester({
                        name: createForm.name.trim(),
                        starts_on: createForm.starts_on,
                        ends_on: createForm.ends_on,
                      });
                      setShowCreate(false);
                      setCreateForm({ name: "", starts_on: "", ends_on: "" });
                    }}
                  >
                    Create
                  </button>
                </div>
              </div>
            </div>
          )}

          {showEdit && (
            <div className="manage-modal">
              <div className="manage-modal-card">
                <div className="manage-modal-title">Edit Semester</div>
                <div className="manage-modal-body">
                  <label className="manage-label">Semester name</label>
                  <input
                    className="manage-input"
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="2026 Spring"
                  />
                  <div className="manage-inline">
                    <div className="manage-field">
                      <label className="manage-label">Start date</label>
                      <input
                        type="date"
                        className={`manage-input manage-date${editForm.starts_on ? "" : " is-empty"}`}
                        value={editForm.starts_on}
                        onChange={(e) => setEditForm((f) => ({ ...f, starts_on: e.target.value }))}
                        max="9999-12-31"
                      />
                    </div>
                    <div className="manage-field">
                      <label className="manage-label">End date</label>
                      <input
                        type="date"
                        className={`manage-input manage-date${editForm.ends_on ? "" : " is-empty"}`}
                        value={editForm.ends_on}
                        onChange={(e) => setEditForm((f) => ({ ...f, ends_on: e.target.value }))}
                        max="9999-12-31"
                      />
                    </div>
                  </div>
                  {editMeta.yearError && <div className="manage-field-error">{editMeta.yearError}</div>}
                  {editMeta.dateError && <div className="manage-field-error">{editMeta.dateError}</div>}
                </div>
                <div className="manage-modal-actions">
                  <button className="manage-btn" type="button" onClick={() => setShowEdit(false)}>
                    Cancel
                  </button>
                  <button
                    className="manage-btn primary"
                    type="button"
                    disabled={!editMeta.canSubmit}
                    onClick={() => {
                      onUpdateSemester({
                        id: editForm.id,
                        name: editForm.name.trim(),
                        starts_on: editForm.starts_on,
                        ends_on: editForm.ends_on,
                      });
                      setShowEdit(false);
                      setEditForm({ id: "", name: "", starts_on: "", ends_on: "" });
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
