// src/admin/ManageJurorsPanel.jsx

import { useRef, useState } from "react";
import {
  ChevronDownIcon,
  ClipboardCheckIcon,
  KeyRoundIcon,
  LockIcon,
  PencilIcon,
  SearchIcon,
  UserRoundCheckIcon,
  CirclePlusIcon,
} from "../shared/Icons";
import DangerIconButton from "../components/admin/DangerIconButton";
import LastActivity from "./LastActivity";

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
    if ((ch === "," || ch === ";") && !inQuotes) {
      row.push(cur.trim());
      cur = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (cur.length || row.length) {
        row.push(cur.trim());
        rows.push(row);
      }
      row = [];
      cur = "";
      if (ch === "\r" && next === "\n") i++;
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

function normalizeKey(name, inst) {
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  return `${norm(name)}|${norm(inst)}`;
}

export default function ManageJurorsPanel({
  jurors,
  isMobile,
  isOpen,
  onToggle,
  onImport,
  onAddJuror,
  onEditJuror,
  onResetPin,
  onDeleteJuror,
}) {
  const fileRef = useRef(null);
  const [showAdd, setShowAdd] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [form, setForm] = useState({ juror_name: "", juror_inst: "" });
  const [showEdit, setShowEdit] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [editForm, setEditForm] = useState({ juror_name: "", juror_inst: "" });
  const [showImport, setShowImport] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [importError, setImportError] = useState("");
  const [importWarning, setImportWarning] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const canSubmit = form.juror_name.trim() && form.juror_inst.trim();
  const canEdit = editForm.juror_name.trim() && editForm.juror_inst.trim();
  const isJurorLocked = (j) => {
    const lockedUntil = j.locked_until || j.lockedUntil;
    if (typeof j.is_locked === "boolean") return j.is_locked;
    if (typeof j.is_locked === "string") {
      return j.is_locked.toLowerCase() === "true" || j.is_locked.toLowerCase() === "t";
    }
    if (!lockedUntil) return false;
    const d = new Date(lockedUntil);
    return !Number.isNaN(d.getTime()) && d > new Date();
  };
  const orderedJurors = [...jurors].sort((a, b) => {
    const aLocked = isJurorLocked(a);
    const bLocked = isJurorLocked(b);
    if (aLocked !== bLocked) return Number(bLocked) - Number(aLocked);
    const aName = (a.juryName || a.juror_name || "").toLowerCase();
    const bName = (b.juryName || b.juror_name || "").toLowerCase();
    return aName.localeCompare(bName);
  });
  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filteredJurors = normalizedSearch
    ? orderedJurors.filter((j) => {
        const name = j.juryName || j.juror_name || "";
        const inst = j.juryDept || j.juror_inst || "";
        const haystack = `${name} ${inst}`.toLowerCase();
        return haystack.includes(normalizedSearch);
      })
    : orderedJurors;
  const visibleJurors = normalizedSearch
    ? filteredJurors
    : (showAll ? orderedJurors : orderedJurors.slice(0, 4));

  const handleFile = async (file) => {
    if (!file) return;
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) return;
    const header = rows[0].map((h) => h.toLowerCase());
    const idxName = header.indexOf("juror_name");
    const idxInst = header.indexOf("juror_inst");
    if (idxName < 0 || idxInst < 0) {
      setImportError("Header row is required and must include: juror_name, juror_inst.");
      setImportWarning("");
      return;
    }
    const invalidNameRows = [];
    const invalidInstRows = [];
    const duplicateRows = [];
    const seenKeys = new Set();
    const data = rows.slice(1).map((r, idx) => {
      const name = String(r[idxName] || "").trim();
      const instRaw = idxInst >= 0 ? r.slice(idxInst).join(",") : "";
      const inst = String(instRaw || "").trim();
      return {
        juror_name: name,
        juror_inst: inst,
        _row: idx + 2,
        _key: normalizeKey(name, inst),
      };
    }).filter((r) => {
      let isValid = true;
      if (!r.juror_name) {
        invalidNameRows.push(r._row);
        isValid = false;
      }
      if (!r.juror_inst) {
        invalidInstRows.push(r._row);
        isValid = false;
      }
      if (r._key && seenKeys.has(r._key)) {
        duplicateRows.push(r._row);
        isValid = false;
      }
      if (r._key) {
        seenKeys.add(r._key);
      }
      return isValid;
    });
    if (invalidNameRows.length || invalidInstRows.length || duplicateRows.length) {
      const parts = [];
      if (invalidNameRows.length) {
        parts.push(`Missing juror_name at rows: ${invalidNameRows.slice(0, 6).join(", ")}.`);
      }
      if (invalidInstRows.length) {
        parts.push(`Missing juror_inst at rows: ${invalidInstRows.slice(0, 6).join(", ")}.`);
      }
      if (duplicateRows.length) {
        parts.push(`Duplicate juror rows at: ${duplicateRows.slice(0, 6).join(", ")}.`);
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

    const existingKeys = new Set(
      (jurors || []).map((j) => normalizeKey(j.juryName || j.juror_name, j.juryDept || j.juror_inst))
    );
    const skippedExisting = data.filter((r) => existingKeys.has(r._key));
    const toImport = data.filter((r) => !existingKeys.has(r._key));

    const localWarning = skippedExisting.length
      ? (() => {
          const preview = skippedExisting
            .slice(0, 4)
            .map((r) => `${r.juror_name} / ${r.juror_inst}`)
            .join("; ");
          const more = skippedExisting.length > 4 ? ` (+${skippedExisting.length - 4} more)` : "";
          return `Skipped existing jurors: ${preview}${more}.`;
        })()
      : "";
    setImportWarning(localWarning);

    if (!toImport.length) {
      setImportError("");
      return;
    }

    setImportError("");
    const res = await onImport?.(toImport.map(({ juror_name, juror_inst }) => ({ juror_name, juror_inst })));
    const serverSkipped = Number(res?.skipped || 0);
    if (serverSkipped > 0) {
      const extra = `Skipped ${serverSkipped} existing jurors during import.`;
      setImportWarning(localWarning ? `${localWarning} ${extra}` : extra);
    }
    if (!skippedExisting.length && serverSkipped === 0) setShowImport(false);
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
          <span className="manage-card-icon" aria-hidden="true"><UserRoundCheckIcon /></span>
          Juror Management
        </div>
        {isMobile && <ChevronDownIcon className={`manage-chevron${isOpen ? " open" : ""}`} />}
      </button>

      {(!isMobile || isOpen) && (
        <div className="manage-card-body">
          <div className="manage-card-desc">Import jurors, edit details, and reset PINs when needed.</div>
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
              <span aria-hidden="true"><CirclePlusIcon className="manage-btn-icon" /></span>
              Juror
            </button>
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
              const isLocked = isJurorLocked(j);
              const scoredSemesters = Array.isArray(j.scoredSemesters)
                ? j.scoredSemesters.filter(Boolean)
                : Array.isArray(j.scored_semesters)
                  ? j.scored_semesters.filter(Boolean)
                  : [];
              const scoredLabel = scoredSemesters.join(" · ");
              const jurorId = j.jurorId || j.juror_id;
              const lastActivityAt =
                j.lastActivityAt
                || j.last_activity_at
                || j.lastSeenAt
                || j.last_seen_at
                || "";
              return (
                <div
                  key={jurorId}
                  className={`manage-item${isLocked ? " is-locked" : ""}`}
                >
                  <div>
                    <div className="manage-item-title">{j.juryName || j.juror_name}</div>
                    <div className="manage-item-sub">{j.juryDept || j.juror_inst}</div>
                    {scoredSemesters.length > 0 && (
                      <div className="manage-item-semesters" title={scoredLabel}>
                        <span className="manage-item-semesters-icon" aria-hidden="true">
                          <ClipboardCheckIcon />
                        </span>
                        <span className="manage-item-semesters-text">{scoredLabel}</span>
                      </div>
                    )}
                    <div className="manage-item-sub manage-meta-line">
                      <LastActivity value={lastActivityAt} />
                    </div>
                  </div>
                  <div className="manage-item-actions">
                    {isLocked && (
                      <span className="manage-lock-icon" title="Locked" aria-label="Locked">
                        <LockIcon />
                      </span>
                    )}
                    <button
                      className={`manage-icon-btn${isLocked ? " danger" : ""}`}
                      type="button"
                      title="Reset PIN"
                      aria-label={`Reset PIN for ${j.juryName || j.juror_name}`}
                      onClick={() => {
                        onResetPin?.({
                          jurorId: j.jurorId || j.juror_id,
                          juror_name: j.juryName || j.juror_name || "",
                          juror_inst: j.juryDept || j.juror_inst || "",
                        });
                      }}
                    >
                      <KeyRoundIcon />
                    </button>
                    <button
                      className={`manage-icon-btn${isLocked ? " danger" : ""}`}
                      type="button"
                      title="Edit juror"
                      aria-label={`Edit ${j.juryName || j.juror_name}`}
                      onClick={() => {
                        setEditTarget(j);
                        setEditForm({
                          juror_name: j.juryName || j.juror_name || "",
                          juror_inst: j.juryDept || j.juror_inst || "",
                        });
                        setShowEdit(true);
                      }}
                    >
                      <PencilIcon />
                    </button>
                    <DangerIconButton
                      ariaLabel={`Delete ${j.juryName || j.juror_name}`}
                      title="Delete juror"
                      showLabel={false}
                      onClick={() => onDeleteJuror?.(j)}
                    />
                  </div>
                </div>
              );
            })}
            {!normalizedSearch && jurors.length === 0 && (
              <div className="manage-empty">No jurors found.</div>
            )}
            {normalizedSearch && filteredJurors.length === 0 && (
              <div className="manage-empty manage-empty-search">No results.</div>
            )}
          </div>

          {!normalizedSearch && jurors.length > 4 && (
            <button
              className="manage-btn ghost"
              type="button"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Show fewer jurors" : `Show all jurors (${jurors.length})`}
            </button>
          )}

          {showAdd && (
            <div className="manage-modal">
              <div className="manage-modal-card">
                <div className="manage-modal-title">Add Juror</div>
                <div className="manage-modal-body">
                  <label className="manage-label">Full name</label>
                  <input
                    className="manage-input"
                    value={form.juror_name}
                    onChange={(e) => setForm((f) => ({ ...f, juror_name: e.target.value }))}
                    placeholder="Dr. Andrew Collins"
                  />
                  <label className="manage-label">Department / Institution</label>
                  <input
                    className="manage-input"
                    value={form.juror_inst}
                    onChange={(e) => setForm((f) => ({ ...f, juror_inst: e.target.value }))}
                    placeholder="Electrical Engineering"
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
                      onAddJuror({
                        juror_name: form.juror_name.trim(),
                        juror_inst: form.juror_inst.trim(),
                      });
                      setShowAdd(false);
                      setForm({ juror_name: "", juror_inst: "" });
                    }}
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          )}

          {showEdit && (
            <div className="manage-modal">
              <div className="manage-modal-card">
                <div className="manage-modal-title">Edit Juror</div>
                <div className="manage-modal-body">
                  <label className="manage-label">Full name</label>
                  <input
                    className="manage-input"
                    value={editForm.juror_name}
                    onChange={(e) => setEditForm((f) => ({ ...f, juror_name: e.target.value }))}
                  />
                  <label className="manage-label">Department / Institution</label>
                  <input
                    className="manage-input"
                    value={editForm.juror_inst}
                    onChange={(e) => setEditForm((f) => ({ ...f, juror_inst: e.target.value }))}
                  />
                </div>
                <div className="manage-modal-actions">
                  <button
                    className="manage-btn"
                    type="button"
                    onClick={() => {
                      setShowEdit(false);
                      setEditTarget(null);
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    className="manage-btn primary"
                    type="button"
                    disabled={!canEdit}
                    onClick={() => {
                      onEditJuror?.({
                        jurorId: editTarget?.jurorId || editTarget?.juror_id,
                        juror_name: editForm.juror_name.trim(),
                        juror_inst: editForm.juror_inst.trim(),
                      });
                      setShowEdit(false);
                      setEditTarget(null);
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
                      Only `.csv` files. Header is required.
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
                    <div className="manage-code">juror_name,juror_inst</div>
                    <div className="manage-code">Ava Johnson,Harvard University / Applied Physics</div>
                    <div className="manage-code">Ayşe Demir,Middle East Technical University / Electrical Engineering</div>
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
