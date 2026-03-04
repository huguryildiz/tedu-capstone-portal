// src/admin/ManageProjectsPanel.jsx

import { useRef, useState } from "react";
import { CalendarRangeIcon, ChevronDownIcon, FileTextIcon, FolderKanbanIcon, PencilIcon, UsersLucideIcon } from "../shared/Icons";

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"') {
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if ((ch === ',' || ch === ';') && !inQuotes) {
      row.push(cur.trim());
      cur = "";
      continue;
    }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (cur.length || row.length) {
        row.push(cur.trim());
        rows.push(row);
      }
      row = [];
      cur = "";
      if (ch === '\r' && next === '\n') i++;
      continue;
    }
    cur += ch;
  }
  if (cur.length || row.length) {
    row.push(cur.trim());
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c !== ""));
}

function splitStudents(text) {
  if (!text) return [];
  return text
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function ManageProjectsPanel({
  projects,
  semesterName,
  isMobile,
  isOpen,
  onToggle,
  onImport,
  onAddGroup,
  onEditGroup,
}) {
  const fileRef = useRef(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showMore, setShowMore] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [form, setForm] = useState({ group_no: "", project_title: "", group_students: "" });
  const [showEdit, setShowEdit] = useState(false);
  const [editForm, setEditForm] = useState({ group_no: "", project_title: "", group_students: "" });
  const [importError, setImportError] = useState("");
  const [importWarning, setImportWarning] = useState("");

  const canSubmit =
    String(form.group_no).trim() &&
    form.project_title.trim() &&
    String(form.group_students).trim();
  const canEditSubmit =
    String(editForm.group_no).trim() &&
    editForm.project_title.trim() &&
    String(editForm.group_students).trim();
  const orderedProjects = [...projects].sort((a, b) => {
    const aNo = Number(a.group_no || 0);
    const bNo = Number(b.group_no || 0);
    return aNo - bNo;
  });
  const visibleProjects = orderedProjects.slice(0, 3);
  const hiddenProjects = orderedProjects.slice(3);

  const renderProject = (p, idx) => {
    const students = splitStudents(p.group_students);
    const groupLabel = Number.isFinite(Number(p.group_no)) && Number(p.group_no) > 0
      ? Number(p.group_no)
      : idx + 1;
    return (
      <div key={p.id || `${p.group_no}-${p.project_title}`} className="manage-item">
        <div>
          <div className="manage-item-title">Group {groupLabel}</div>
          <div className="manage-item-sub manage-meta-line">
            <span className="manage-meta-icon" aria-hidden="true"><FileTextIcon /></span>
            <span>{p.project_title || "—"}</span>
          </div>
          <div className="manage-item-sub manage-meta-line">
            <span className="manage-meta-icon" aria-hidden="true"><UsersLucideIcon /></span>
            <span className="manage-students">
              {students.length
                ? students.map((name, sidx) => (
                    <span key={`${p.id}-student-${sidx}`} className="manage-student">
                      <em>{name}</em>{sidx < students.length - 1 ? " · " : ""}
                    </span>
                  ))
                : "—"}
            </span>
          </div>
          <div className="manage-item-sub manage-meta-line">
            <span className="manage-meta-icon manage-semester-date-icon" aria-hidden="true">
              <CalendarRangeIcon />
            </span>
            <span className="manage-item-semester-text">{semesterName || "—"}</span>
          </div>
        </div>
        <div className="manage-item-actions">
          <button
            className="manage-icon-btn"
            type="button"
            title="Edit project"
            aria-label={`Edit Group ${groupLabel}`}
            onClick={() => {
              setEditForm({
                group_no: p.group_no,
                project_title: p.project_title || "",
                group_students: p.group_students || "",
              });
              setShowEdit(true);
            }}
          >
            <PencilIcon />
          </button>
        </div>
      </div>
    );
  };

  const handleFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) return;
    const header = rows[0].map((h) => h.toLowerCase());
    const idxGroup = header.indexOf("group_no");
    const idxTitle = header.indexOf("project_title");
    const idxStudents = header.indexOf("group_students");
    if (idxGroup < 0 || idxTitle < 0 || idxStudents < 0) {
      setImportError("Header row is required and must include: group_no, project_title, group_students.");
      setImportWarning("");
      return;
    }
    const invalidGroupRows = [];
    const invalidTitleRows = [];
    const invalidStudentsRows = [];
    const duplicateGroupRows = [];
    const seenGroups = new Set();
    const data = rows.slice(1).map((r) => {
      const studentsRaw = idxStudents >= 0 ? r.slice(idxStudents).join(";") : "";
      const studentsText = String(studentsRaw || "").trim();
      const groupNo = Number(r[idxGroup] || 0);
      const title = String(r[idxTitle] || "").trim();
      return {
        group_no: groupNo,
        project_title: title,
        group_students: studentsText,
      };
    }).filter((r, idx) => {
      const rowNo = idx + 2; // include header row
      let isValid = true;
      if (!Number.isFinite(r.group_no) || r.group_no <= 0) {
        invalidGroupRows.push(rowNo);
        isValid = false;
      }
      if (!r.project_title) {
        invalidTitleRows.push(rowNo);
        isValid = false;
      }
      if (!r.group_students) {
        invalidStudentsRows.push(rowNo);
        isValid = false;
      }
      if (seenGroups.has(r.group_no)) {
        duplicateGroupRows.push(rowNo);
        isValid = false;
      }
      if (Number.isFinite(r.group_no) && r.group_no > 0) {
        seenGroups.add(r.group_no);
      }
      return isValid;
    });
    if (
      invalidGroupRows.length ||
      invalidTitleRows.length ||
      invalidStudentsRows.length ||
      duplicateGroupRows.length
    ) {
      const parts = [];
      if (invalidGroupRows.length) {
        parts.push(`Invalid group_no at rows: ${invalidGroupRows.slice(0, 6).join(", ")}.`);
      }
      if (invalidTitleRows.length) {
        parts.push(`Missing project_title at rows: ${invalidTitleRows.slice(0, 6).join(", ")}.`);
      }
      if (invalidStudentsRows.length) {
        parts.push(`Missing group_students at rows: ${invalidStudentsRows.slice(0, 6).join(", ")}.`);
      }
      if (duplicateGroupRows.length) {
        parts.push(`Duplicate group_no at rows: ${duplicateGroupRows.slice(0, 6).join(", ")}.`);
      }
      setImportError(parts.join(" "));
      setImportWarning("");
      return;
    }
    if (!data.length) {
      setImportError("No valid rows found in CSV.");
      setImportWarning("");
      return;
    }
    const existingGroupNos = new Set(
      (projects || [])
        .map((p) => Number(p.group_no))
        .filter((n) => Number.isFinite(n) && n > 0)
    );
    const skippedExisting = data.filter((r) => existingGroupNos.has(r.group_no));
    const toImport = data.filter((r) => !existingGroupNos.has(r.group_no));

    if (skippedExisting.length) {
      const skippedList = Array.from(new Set(skippedExisting.map((r) => r.group_no))).join(", ");
      setImportWarning(`Skipped existing group_no: ${skippedList}.`);
    } else {
      setImportWarning("");
    }

    if (!toImport.length) {
      setImportError("");
      return;
    }

    setImportError("");
    onImport(toImport);
    if (!skippedExisting.length) setShowImport(false);
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    await handleFile(file);
    e.target.value = "";
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
          <span className="manage-card-icon" aria-hidden="true"><FolderKanbanIcon /></span>
          Project / Group Management
        </div>
        {isMobile && <ChevronDownIcon className={`manage-chevron${isOpen ? " open" : ""}`} />}
      </button>

      {(!isMobile || isOpen) && (
        <div className="manage-card-body">
          <div className="manage-card-desc">Manage groups, project titles, and student lists for the active semester.</div>
          <div className="manage-card-actions">
            <button
              className="manage-btn"
              type="button"
              onClick={() => {
                setImportError("");
                setImportWarning("");
                setShowImport(true);
              }}
            >
              Import CSV
            </button>
            <button className="manage-btn primary" type="button" onClick={() => setShowAdd(true)}>
              Add Group
            </button>
          </div>

          <div className="manage-list">
            {visibleProjects.map((p, idx) => renderProject(p, idx))}
            {orderedProjects.length === 0 && (
              <div className="manage-empty">No projects for the active semester.</div>
            )}
          </div>

          {hiddenProjects.length > 0 && (
            <>
              <div className="manage-accordion">
                <div id="manage-more-groups" className={`group-accordion-panel${showMore ? " open" : ""}`}>
                  <div className="group-accordion-panel-inner manage-list">
                    {hiddenProjects.map((p, idx) => renderProject(p, idx + visibleProjects.length))}
                  </div>
                </div>
                {!showMore && (
                  <button
                    className="manage-btn ghost"
                    type="button"
                    aria-expanded={showMore}
                    aria-controls="manage-more-groups"
                    onClick={() => setShowMore((v) => !v)}
                  >
                    {`Show all groups (${orderedProjects.length})`}
                  </button>
                )}
              </div>
              {showMore && (
                <button
                  className="manage-btn ghost"
                  type="button"
                  aria-expanded={showMore}
                  aria-controls="manage-more-groups"
                  onClick={() => setShowMore((v) => !v)}
                >
                  Show fewer groups
                </button>
              )}
            </>
          )}

          {showAdd && (
            <div className="manage-modal">
              <div className="manage-modal-card">
                <div className="manage-modal-title">Add Group</div>
                <div className="manage-modal-body">
                  <label className="manage-label">Group number</label>
                  <input
                    className="manage-input"
                    value={form.group_no}
                    onChange={(e) => setForm((f) => ({ ...f, group_no: e.target.value }))}
                    placeholder="1"
                  />
                  <label className="manage-label">Project title</label>
                  <input
                    className="manage-input"
                    value={form.project_title}
                    onChange={(e) => setForm((f) => ({ ...f, project_title: e.target.value }))}
                    placeholder="Smart Traffic AI"
                  />
                  <label className="manage-label">Students</label>
                  <textarea
                    className="manage-input manage-textarea"
                    value={form.group_students}
                    onChange={(e) => setForm((f) => ({ ...f, group_students: e.target.value }))}
                    placeholder="Ali;Ayşe;Mehmet"
                    rows={3}
                  />
                </div>
                <div className="manage-modal-actions">
                  <button className="manage-btn" type="button" onClick={() => setShowAdd(false)}>
                    Cancel
                  </button>
                  <button
                    className="manage-btn primary"
                    type="button"
                    disabled={!canSubmit}
                    onClick={() => {
                      onAddGroup({
                        group_no: Number(form.group_no),
                        project_title: form.project_title.trim(),
                        group_students: form.group_students.trim(),
                      });
                      setShowAdd(false);
                      setForm({ group_no: "", project_title: "", group_students: "" });
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}

          {showEdit && (
            <div className="manage-modal">
              <div className="manage-modal-card">
                <div className="manage-modal-title">Edit Group</div>
                <div className="manage-modal-body">
                  <label className="manage-label">Group number</label>
                  <input
                    className="manage-input"
                    value={editForm.group_no}
                    disabled
                  />
                  <label className="manage-label">Project title</label>
                  <input
                    className="manage-input"
                    value={editForm.project_title}
                    onChange={(e) => setEditForm((f) => ({ ...f, project_title: e.target.value }))}
                  />
                  <label className="manage-label">Students</label>
                  <textarea
                    className="manage-input manage-textarea"
                    value={editForm.group_students}
                    onChange={(e) => setEditForm((f) => ({ ...f, group_students: e.target.value }))}
                    rows={3}
                  />
                </div>
                <div className="manage-modal-actions">
                  <button className="manage-btn" type="button" onClick={() => setShowEdit(false)}>
                    Cancel
                  </button>
                  <button
                    className="manage-btn primary"
                    type="button"
                    disabled={!canEditSubmit}
                    onClick={() => {
                      onEditGroup?.({
                        group_no: Number(editForm.group_no),
                        project_title: editForm.project_title.trim(),
                        group_students: editForm.group_students.trim(),
                      });
                      setShowEdit(false);
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          )}

          {showImport && (
            <div className="manage-modal">
              <div className="manage-modal-card">
                <div className="manage-modal-title">Import CSV</div>
                <div className="manage-modal-body">
                  <div className="manage-hint">
                    Upload your CSV file here.
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv"
                    className="manage-input"
                    style={{ display: "none" }}
                    onChange={handleFileChange}
                  />
                  <div
                    className={`manage-dropzone${isDragging ? " is-dragging" : ""}`}
                    onDragEnter={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
                    onDrop={(e) => {
                      e.preventDefault();
                      setIsDragging(false);
                      const file = e.dataTransfer.files?.[0];
                      handleFile(file);
                    }}
                    onClick={() => fileRef.current?.click()}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        fileRef.current?.click();
                      }
                    }}
                  >
                    <div className="manage-dropzone-icon" aria-hidden="true">☁️</div>
                    <div className="manage-dropzone-title">Drag & Drop your CSV here</div>
                    <div className="manage-dropzone-sub">
                      Only `.csv` files. Use semicolon or comma to separate students.
                      If you use semicolons, wrap the students field in quotes.
                    </div>
                    <button className="manage-btn ghost" type="button">
                      Select File
                    </button>
                  </div>
                  {importError && (
                    <div className="manage-hint manage-hint-error">
                      {importError}
                    </div>
                  )}
                  {importWarning && !importError && (
                    <div className="manage-hint manage-hint-warn">
                      {importWarning}
                    </div>
                  )}
                  <div className="manage-hint">
                    Format:
                    <div className="manage-code">group_no,project_title,group_students</div>
                    <div className="manage-code">1,Smart Traffic AI,Ali Yılmaz;Ayşe Demir;Mehmet Kaya</div>
                    <div className="manage-code">2,Edge AI Drone,Zeynep Arslan;Deniz Aydın</div>
                    <div className="manage-code">3,Autonomous Harbor Surveillance,Kerem Öztürk;Elif Yıldız;Burak Polat</div>
                  </div>
                </div>
                <div className="manage-modal-actions">
                  <button className="manage-btn" type="button" onClick={() => setShowImport(false)}>
                    Cancel
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
