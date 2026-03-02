// src/admin/MatrixTab.jsx
// ── Enterprise-style juror × group matrix ─────────────────────
// - Column-based sorting (click group header: desc → asc → reset)
// - Sticky header + frozen first column
// - Juror column text filter
// - Final-only averages (all_submitted only)

import { useState, useMemo, useEffect } from "react";
import { cmp, rowKey } from "./utils";
import { readSection, writeSection } from "./persist";
import { FilterPopoverPortal } from "./components";
import {
  FilterIcon,
  ArrowUpDownIcon,
  ArrowDown01Icon,
  ArrowDown10Icon,
  InfoIcon,
  CheckIcon,
  HourglassIcon,
  PencilIcon,
  CircleCheckBigIcon,
  CircleIcon,
} from "../shared/Icons";

// ── Cell helpers ──────────────────────────────────────────────

const cellStyle = (entry) => {
  if (!entry) return { background: "#f8fafc", color: "#94a3b8" };
  if (entry.status === "all_submitted")   return { background: "#dcfce7", color: "#166534", fontWeight: 700 };
  if (entry.status === "group_submitted") return { background: "#ecfdf3", color: "#16a34a", fontWeight: 600 };
  if (entry.status === "in_progress")     return { background: "#fef9c3", color: "#92400e" };
  return { background: "#f8fafc", color: "#94a3b8" };
};

const cellText = (entry) => {
  if (!entry) return "";
  if (entry.status === "all_submitted" || entry.status === "group_submitted") return entry.total;
  if (entry.status === "in_progress") return "";  // background color only
  return "";
};

// ── Component ──────────────────────────────────────────────────

// Props:
//   data    – raw rows
//   jurors  – { key, name, dept }[]  (from AdminPanel uniqueJurors)
//   groups  – { id, label }[]
export default function MatrixTab({ data, jurors, groups }) {
  // Group column sort state
  const [sortGroupId,  setSortGroupId]  = useState(() => { const s = readSection("matrix"); return (s.sortGroupId === null || typeof s.sortGroupId === "number") ? s.sortGroupId ?? null : null; });
  const [sortGroupDir, setSortGroupDir] = useState(() => { const s = readSection("matrix"); return s.sortGroupDir === "asc" || s.sortGroupDir === "desc" ? s.sortGroupDir : "desc"; });
  const [sortJurorDir, setSortJurorDir] = useState(() => { const s = readSection("matrix"); return s.sortJurorDir === "asc" || s.sortJurorDir === "desc" ? s.sortJurorDir : "asc"; });
  const [sortMode,     setSortMode]     = useState(() => { const s = readSection("matrix"); return s.sortMode === "group" ? "group" : "juror"; });

  // Juror text filter
  const [jurorFilter, setJurorFilter] = useState(() => { const s = readSection("matrix"); return typeof s.jurorFilter === "string" ? s.jurorFilter : ""; });

  useEffect(() => {
    writeSection("matrix", { sortGroupId, sortGroupDir, sortJurorDir, sortMode, jurorFilter });
  }, [sortGroupId, sortGroupDir, sortJurorDir, sortMode, jurorFilter]);
  const [activeFilterCol, setActiveFilterCol] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const [anchorEl,   setAnchorEl]   = useState(null);

  const isJurorFilterActive = !!jurorFilter || activeFilterCol === "juror";

  function closePopover() {
    setActiveFilterCol(null);
    setAnchorRect(null);
    setAnchorEl(null);
  }

  function toggleFilterCol(colId, evt) {
    const rect = evt?.currentTarget?.getBoundingClientRect?.();
    const el = evt?.currentTarget ?? null;
    setActiveFilterCol((prev) => {
      const next = prev === colId ? null : colId;
      if (next && rect) { setAnchorRect(rect); setAnchorEl(el); }
      if (!next) { setAnchorRect(null); setAnchorEl(null); }
      return next;
    });
  }

  // Build lookup: jurorKey → { [projectId]: { total, status } }
  const lookup = useMemo(() => {
    const map = {};
    data.forEach((r) => {
      const key = rowKey(r);
      if (!map[key]) map[key] = {};
      map[key][r.projectId] = { total: r.total, status: r.status, editingFlag: r.editingFlag };
    });
    return map;
  }, [data]);

  // Click-to-sort cycle on group columns: none → desc → asc → none
  function toggleGroupSort(gId) {
    if (sortGroupId !== gId) {
      setSortGroupId(gId);
      setSortGroupDir("desc");
      setSortMode("group");
    } else if (sortGroupDir === "desc") {
      setSortGroupDir("asc");
      setSortMode("group");
    } else {
      setSortGroupId(null);
      setSortGroupDir("desc");
      setSortMode("group");
    }
  }

  const groupSortIcon = (gId) => {
    if (sortMode !== "group" || sortGroupId !== gId) return <ArrowUpDownIcon />;
    return sortGroupDir === "desc" ? <ArrowDown10Icon /> : <ArrowDown01Icon />;
  };
  function toggleJurorSort() {
    if (sortMode !== "juror") {
      setSortMode("juror");
      setSortJurorDir("asc");
    } else {
      setSortJurorDir((d) => (d === "asc" ? "desc" : "asc"));
    }
  }

  const visibleJurors = useMemo(() => {
    let list = jurors.slice().sort((a, b) => cmp(a.name, b.name));

    // Apply juror name text filter.
    if (jurorFilter) {
      const q = jurorFilter.toLowerCase();
      list = list.filter((j) => j.name.toLowerCase().includes(q));
    }

    if (sortMode === "juror") {
      list = list.slice().sort((a, b) =>
        sortJurorDir === "asc" ? cmp(a.name, b.name) : cmp(b.name, a.name)
      );
    }
    // Sort by active group column (only all_submitted; missing/non-final → bottom).
    if (sortMode === "group" && sortGroupId !== null) {
      list = [...list].sort((a, b) => {
        const ea = lookup[a.key]?.[sortGroupId];
        const eb = lookup[b.key]?.[sortGroupId];
        const va = ea?.status === "all_submitted" ? Number(ea.total) : null;
        const vb = eb?.status === "all_submitted" ? Number(eb.total) : null;

        // Nulls always sink to bottom regardless of direction.
        if (va === null && vb === null) return cmp(a.name, b.name);
        if (va === null) return 1;
        if (vb === null) return -1;

        const diff = sortGroupDir === "desc" ? vb - va : va - vb;
        return diff !== 0 ? diff : cmp(a.name, b.name); // stable tie-breaker
      });
    }
    // Default order: alpha-sorted by juror name (same comparator as DetailsTab).

    return list;
  }, [jurors, jurorFilter, sortGroupId, sortGroupDir, sortMode, sortJurorDir, lookup]);

  const jurorStatus = (jurorKey) => {
    const entries = groups.map((g) => {
      const entry = lookup[jurorKey]?.[g.id];
      const normalizedStatus =
        entry?.status === "group_submitted" || entry?.status === "all_submitted"
          ? "submitted"
          : entry?.status || "not_started";
      return { status: normalizedStatus, editing: entry?.editingFlag === "editing" };
    });
    if (entries.every((e) => e.status === "not_started")) return "not_started";
    if (entries.some((e) => e.editing)) return "editing";
    if (entries.every((e) => e.status === "submitted")) return "completed";
    if (entries.some((e) => e.status === "in_progress")) return "in_progress";
    if (entries.some((e) => e.status === "submitted")) return "submitted";
    return "not_started";
  };

  const statusLabel = {
    completed: "Completed",
    submitted: "Submitted",
    in_progress: "In Progress",
    editing: "Editing",
    not_started: "Not Started",
  };

  const statusIcon = {
    completed: <CircleCheckBigIcon />,
    submitted: <CheckIcon />,
    in_progress: <HourglassIcon />,
    editing: <PencilIcon />,
    not_started: <CircleIcon />,
  };


  // Average row: final-only entries from visibleJurors, 2 decimal places.
  const groupAverages = useMemo(() =>
    groups.map((g) => {
      const vals = visibleJurors
        .map((j) => lookup[j.key]?.[g.id])
        .filter((e) => e?.status === "all_submitted")
        .map((e) => e.total);
      return vals.length
        ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)
        : null;
    }),
  [visibleJurors, groups, lookup]);

  if (!jurors.length) return <div className="empty-msg">No data yet.</div>;

  return (
    <div className="matrix-wrap">

      {/* Legend */}
      <div className="matrix-subtitle">
        <div className="matrix-legend-row legend-scroll-row">
          <div className="matrix-legend-scroll" aria-label="Cells legend">
            <span className="matrix-legend-label">Cells</span>
            <span className="matrix-legend-item"><span className="matrix-legend-dot completed-dot"/>Completed</span>
            <span className="matrix-legend-item"><span className="matrix-legend-dot submitted-dot"/>Submitted</span>
            <span className="matrix-legend-item"><span className="matrix-legend-dot progress-dot"/>In Progress</span>
            <span className="matrix-legend-item"><span className="matrix-legend-dot empty-dot"/>Not Started</span>
          </div>
        </div>
        <div className="matrix-legend-row matrix-icon-legend legend-scroll-row">
          <div className="matrix-legend-scroll" aria-label="Juror legend">
            <span className="matrix-legend-label">Juror</span>
            <span className="matrix-icon-legend-item">
              <span className="matrix-status-icon completed"><CircleCheckBigIcon /></span>
              Completed
            </span>
            <span className="matrix-icon-legend-item">
              <span className="matrix-status-icon editing"><PencilIcon /></span>
              Editing
            </span>
            <span className="matrix-icon-legend-item">
              <span className="matrix-status-icon in_progress"><HourglassIcon /></span>
              In Progress
            </span>
            <span className="matrix-icon-legend-item">
              <span className="matrix-status-icon not_started"><CircleIcon /></span>
              Not Started
            </span>
          </div>
        </div>
        {visibleJurors.length < jurors.length && (
          <span className="matrix-legend-count">
            Showing {visibleJurors.length}/{jurors.length} jurors
          </span>
        )}
      </div>

      <div className="matrix-scroll-wrap">
        <div className="matrix-scroll">
          <table className="matrix-table">
            <thead>
              <tr>
                {/* Juror column — text filter only */}
                <th className="matrix-corner">
                  <div className="matrix-corner-head">
                    <span
                      className={`col-sort-label${isJurorFilterActive ? " filtered" : ""}`}
                      onClick={toggleJurorSort}
                    >
                      Juror / Group
                    </span>
                    <button
                      type="button"
                      className={`col-filter-hotspot${isJurorFilterActive ? " active filter-icon-active" : ""}`}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFilterCol("juror", e); }}
                      title="Filter jurors"
                    ><FilterIcon /></button>
                  </div>
                </th>

              {/* Group columns — click-to-sort only, no filter */}
              {groups.map((g) => {
                const isActive = sortGroupId === g.id;
                return (
                  <th key={g.id}>
                    <button
                      className={`matrix-col-sort${isActive ? " active" : ""}`}
                      onClick={() => toggleGroupSort(g.id)}
                      title={`Sort by ${g.id}`}
                    >
                      <strong>{g.id}</strong>
                      <span className="sort-icon">{groupSortIcon(g.id)}</span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {visibleJurors.map((juror) => (
              <tr key={juror.key}>
                <td className="matrix-juror">
                  {(() => {
                    const status = jurorStatus(juror.key);
                    const fullName = juror.dept ? `${juror.name} (${juror.dept})` : juror.name;
                    return (
                      <>
                        <span
                          className={`matrix-status-icon ${status}`}
                          title={statusLabel[status]}
                          aria-hidden="true"
                        >
                          {statusIcon[status]}
                        </span>
                        <span className="matrix-juror-name" title={fullName}>
                          <span className="matrix-juror-name-scroll">
                            {juror.name}
                            {juror.dept && <span className="matrix-juror-dept"> ({juror.dept})</span>}
                          </span>
                        </span>
                      </>
                    );
                  })()}
                </td>
                {groups.map((g) => {
                  const entry = lookup[juror.key]?.[g.id] ?? null;
                  return (
                    <td key={g.id} style={cellStyle(entry)}>{cellText(entry)}</td>
                  );
                })}
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="matrix-avg-row">
              <td className="matrix-juror matrix-avg-label">Average</td>
              {groupAverages.map((avg, i) => (
                <td key={groups[i].id} className="matrix-avg-cell">
                  {avg !== null ? avg : "—"}
                </td>
              ))}
            </tr>
          </tfoot>
          </table>
        </div>
      </div>

      {/* Info note */}
      <p className="matrix-info-note"><InfoIcon /> Averages include only completed submissions.</p>

      <FilterPopoverPortal
        open={activeFilterCol === "juror"}
        anchorRect={anchorRect}
        anchorEl={anchorEl}
        onClose={closePopover}
        className="col-filter-popover col-filter-popover-portal"
        contentKey={jurorFilter}
      >
        <input
          autoFocus
          placeholder="Filter juror name…"
          value={jurorFilter}
          onChange={(e) => setJurorFilter(e.target.value)}
          className={isJurorFilterActive ? "filter-input-active" : ""}
        />
        {jurorFilter && (
          <button className="col-filter-clear" onClick={() => { setJurorFilter(""); closePopover(); }}>
            Clear
          </button>
        )}
      </FilterPopoverPortal>
    </div>
  );
}
