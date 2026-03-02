// src/admin/DetailsTab.jsx
// ============================================================
// Sortable details table with Excel-style column header filters.
// ============================================================

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PROJECTS } from "../config";
import { cmp, exportXLSX, formatTs, tsToMillis } from "./utils";
import { readSection, writeSection } from "./persist";
import { StatusBadge, useOutsidePointerDown } from "./components";
import { FilterIcon, DownloadIcon, ArrowUpDownIcon, ArrowDown01Icon, ArrowDown10Icon, ArrowDownIcon, ArrowUpIcon, XIcon } from "../shared/Icons";

const PROJECT_LIST = PROJECTS.map((p, i) =>
  typeof p === "string"
    ? { id: i + 1, name: p, desc: "", students: [] }
    : { id: p.id ?? i + 1, name: p.name ?? `Group ${i + 1}`, desc: p.desc ?? "", students: p.students ?? [] }
);

// Show "" for null/undefined/empty/NaN.  0 is a valid score.
function displayScore(val) {
  if (val === "" || val === null || val === undefined) return "";
  if (typeof val === "string" && val.trim() === "") return "";
  const n = Number(val);
  if (!Number.isFinite(n)) return "";
  return n;
}

const STATUS_OPTIONS = [
  { key: "in_progress",     label: "In Progress" },
  { key: "submitted",       label: "Submitted"   },
];

const SCORE_COLS = [
  { key: "technical", label: "Technical /30" },
  { key: "design",    label: "Written /30"   },
  { key: "delivery",  label: "Oral /30"      },
  { key: "teamwork",  label: "Teamwork /10"  },
  { key: "total",     label: "Total"         },
];

// Stable per-row key matching AdminPanel's rowKey.
function rowKey(r) {
  return r.jurorId
    ? r.jurorId
    : `${(r.juryName || "").trim().toLowerCase()}__${(r.juryDept || "").trim().toLowerCase()}`;
}

function FilterPopoverPortal({ open, anchorRect, anchorEl, onClose, className, contentKey, mode = "anchor", children }) {
  const popRef = useRef(null);
  const [style, setStyle] = useState({ left: 0, top: 0, visibility: "hidden" });

  useOutsidePointerDown(open, [popRef, anchorEl], onClose);

  useLayoutEffect(() => {
    if (!open || !popRef.current) return;
    const pop = popRef.current;
    const measureAndPlace = () => {
      if (mode === "center") {
        setStyle({ left: "50%", top: "50%", transform: "translate(-50%, -50%)", visibility: "visible" });
        return;
      }
      if (!anchorRect) return;
      const margin = 8;
      const popW = pop.offsetWidth;
      const popH = pop.offsetHeight;
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;

      let left = anchorRect.left;
      left = Math.min(left, viewportW - popW - margin);
      left = Math.max(margin, left);

      let top = anchorRect.bottom + 6;
      if (top + popH + margin > viewportH) {
        const above = anchorRect.top - popH - 6;
        if (above >= margin) top = above;
        else top = Math.max(margin, viewportH - popH - margin);
      }

      setStyle({ left, top, transform: "none", visibility: "visible" });
    };

    measureAndPlace();
    window.addEventListener("resize", measureAndPlace);
    window.addEventListener("orientationchange", measureAndPlace);
    return () => {
      window.removeEventListener("resize", measureAndPlace);
      window.removeEventListener("orientationchange", measureAndPlace);
    };
  }, [open, anchorRect, contentKey, mode]);

  if (!open || (mode !== "center" && !anchorRect)) return null;

  return createPortal(
    <div
      ref={popRef}
      className={className}
      style={style}
      role="dialog"
      aria-modal="true"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}

// jurors prop: { key, name, dept }[]
export default function DetailsTab({ data, jurors }) {
  const VALID_STATUSES = ["in_progress", "submitted"];
  const VALID_SORT_DIRS = ["asc", "desc"];
  const [filterJuror,    setFilterJuror]    = useState(() => { const s = readSection("details"); return typeof s.filterJuror  === "string" ? s.filterJuror  : "ALL"; });
  const [filterDept,     setFilterDept]     = useState(() => { const s = readSection("details"); return typeof s.filterDept   === "string" ? s.filterDept   : "ALL"; });
  const [filterGroup,    setFilterGroup]    = useState(() => { const s = readSection("details"); return typeof s.filterGroup  === "string" ? s.filterGroup  : "ALL"; });
  const [filterStatuses, setFilterStatuses] = useState(() => { const s = readSection("details"); return new Set(Array.isArray(s.filterStatuses) ? s.filterStatuses.filter((k) => VALID_STATUSES.includes(k)) : []); });
  const [filterEditing,  setFilterEditing]  = useState(() => { const s = readSection("details"); return typeof s.filterEditing === "string" ? s.filterEditing : "ALL"; });
  const [dateFrom,       setDateFrom]       = useState(() => { const s = readSection("details"); return typeof s.dateFrom     === "string" ? s.dateFrom     : ""; });
  const [dateTo,         setDateTo]         = useState(() => { const s = readSection("details"); return typeof s.dateTo       === "string" ? s.dateTo       : ""; });
  const [dateError,      setDateError]      = useState(null);
  const [filterComment,  setFilterComment]  = useState(() => { const s = readSection("details"); return typeof s.filterComment === "string" ? s.filterComment : ""; });
  const [sortKey,        setSortKey]        = useState(() => { const s = readSection("details"); return typeof s.sortKey === "string" && s.sortKey ? s.sortKey : "tsMs"; });
  const [sortDir,        setSortDir]        = useState(() => { const s = readSection("details"); return VALID_SORT_DIRS.includes(s.sortDir) ? s.sortDir : "desc"; });
  const [activeFilterCol, setActiveFilterCol] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const [anchorEl, setAnchorEl] = useState(null);
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== "undefined" && window.matchMedia("(max-width: 480px)").matches
  ));

  const groups = useMemo(
    () => PROJECT_LIST.map((p) => ({ id: p.id, label: `Group ${p.id}`, name: p.name }))
      .sort((a, b) => a.id - b.id),
    []
  );
  const deptOptions = useMemo(() => {
    const map = new Map();
    jurors.forEach((j) => {
      const label = String(j?.dept ?? "").trim();
      if (!label) return;
      map.set(label.toLowerCase(), label);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([key, label]) => ({ key, label }));
  }, [jurors]);

  useEffect(() => {
    if (!isMobile) return;
    if (activeFilterCol !== "timestamp") return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [activeFilterCol, isMobile]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 480px)");
    const update = () => setIsMobile(mq.matches);
    update();
    if (mq.addEventListener) mq.addEventListener("change", update);
    else mq.addListener(update);
    return () => {
      if (mq.addEventListener) mq.removeEventListener("change", update);
      else mq.removeListener(update);
    };
  }, []);

  useEffect(() => {
    writeSection("details", {
      filterJuror, filterDept, filterGroup,
      filterStatuses: [...filterStatuses],
      filterEditing,
      dateFrom, dateTo, filterComment,
      sortKey, sortDir,
    });
  }, [filterJuror, filterDept, filterGroup, filterStatuses, filterEditing, dateFrom, dateTo, filterComment, sortKey, sortDir]);

  function isValidDateParts(yyyy, mm, dd) {
    if (yyyy < 2000 || yyyy > 2100) return false;
    if (mm < 1 || mm > 12) return false;
    if (dd < 1) return false;
    const maxDays = new Date(yyyy, mm, 0).getDate();
    return dd <= maxDays;
  }

  function parseDateString(value) {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [yyyy, mm, dd] = value.split("-").map(Number);
      if (!isValidDateParts(yyyy, mm, dd)) return null;
      return new Date(yyyy, mm - 1, dd).getTime();
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
      const [dd, mm, yyyy] = value.split("/").map(Number);
      if (!isValidDateParts(yyyy, mm, dd)) return null;
      return new Date(yyyy, mm - 1, dd).getTime();
    }
    return null;
  }

  const parsedFromMs = useMemo(() => (dateFrom ? parseDateString(dateFrom) : null), [dateFrom]);
  const parsedToMs = useMemo(() => (dateTo ? parseDateString(dateTo) : null), [dateTo]);
  const isInvalidRange = useMemo(() => {
    if (parsedFromMs === null || parsedToMs === null) return false;
    return parsedFromMs > parsedToMs;
  }, [parsedFromMs, parsedToMs]);

  useEffect(() => {
    if ((dateFrom && parsedFromMs === null) || (dateTo && parsedToMs === null)) {
      setDateError("Invalid date format.");
    } else if (isInvalidRange) {
      setDateError("The 'From' date cannot be later than the 'To' date.");
    } else {
      setDateError(null);
    }
  }, [dateFrom, dateTo, parsedFromMs, parsedToMs, isInvalidRange]);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filterJuror !== "ALL") count += 1;
    if (filterDept !== "ALL") count += 1;
    if (filterGroup !== "ALL") count += 1;
    if (filterStatuses.size > 0) count += 1;
    if (filterEditing !== "ALL") count += 1;
    if (dateFrom || dateTo) count += 1;
    if (filterComment) count += 1;
    return count;
  }, [filterJuror, filterDept, filterGroup, filterStatuses, filterEditing, dateFrom, dateTo, filterComment]);
  const hasAnyFilter = activeFilterCount > 0;
  const isJurorFilterActive = filterJuror !== "ALL" || activeFilterCol === "juror";
  const isDeptFilterActive = filterDept !== "ALL" || activeFilterCol === "dept";
  const isGroupFilterActive = filterGroup !== "ALL" || activeFilterCol === "group";
  const isDateFilterActive = !!dateFrom || !!dateTo || activeFilterCol === "timestamp";
  const isStatusFilterActive = filterStatuses.size > 0 || activeFilterCol === "status";
  const isEditingFilterActive = filterEditing !== "ALL" || activeFilterCol === "editing";
  const isCommentFilterActive = !!filterComment || activeFilterCol === "comments";

  function resetFilters() {
    setFilterJuror("ALL");
    setFilterDept("ALL");
    setFilterGroup("ALL");
    setFilterStatuses(new Set());
    setFilterEditing("ALL");
    setDateFrom("");
    setDateTo("");
    setDateError(null);
    setFilterComment("");
    setSortKey("tsMs");
    setSortDir("desc");
    setActiveFilterCol(null);
    setAnchorRect(null);
  }

  function toggleStatus(key) {
    setFilterStatuses((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

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
      if (next && rect) {
        setAnchorRect(rect);
        setAnchorEl(el);
      }
      if (!next) {
        setAnchorRect(null);
        setAnchorEl(null);
      }
      return next;
    });
  }

  function isMissing(val) {
    if (val === "" || val === null || val === undefined) return true;
    if (typeof val === "string" && val.trim() === "") return true;
    if (typeof val === "number") return !Number.isFinite(val);
    return false;
  }

  const rows = useMemo(() => {
    const fromMs = parsedFromMs ?? 0;
    const toMsBase = parsedToMs ?? Infinity;
    const toMs = Number.isFinite(toMsBase)
      ? toMsBase + 24 * 60 * 60 * 1000 - 1
      : toMsBase;

    let list = data.slice();

    if (filterJuror !== "ALL") {
      list = list.filter((r) => rowKey(r) === filterJuror);
    }
    if (filterGroup !== "ALL") {
      list = list.filter((r) => String(r.projectId) === filterGroup);
    }
    if (filterDept !== "ALL") {
      const q = filterDept.toLowerCase();
      list = list.filter((r) => String(r.juryDept ?? "").trim().toLowerCase() === q);
    }
    if (filterStatuses.size > 0) {
      list = list.filter((r) => {
        const isSubmittedStatus = r.status === "group_submitted" || r.status === "all_submitted";
        const isInProgressStatus = r.status === "in_progress";

        if (filterStatuses.has("submitted") && isSubmittedStatus) return true;
        if (filterStatuses.has("in_progress") && isInProgressStatus) return true;
        return false;
      });
    }
    if (filterEditing !== "ALL") {
      list = list.filter((r) => {
        const isEditing = r.editingFlag === "editing";
        return filterEditing === "editing" ? isEditing : !isEditing;
      });
    }
    const canApplyDateFilter =
      (!dateFrom || parsedFromMs !== null) &&
      (!dateTo || parsedToMs !== null) &&
      !isInvalidRange;
    if ((dateFrom || dateTo) && canApplyDateFilter) {
      list = list.filter((r) => {
        const ms = r.tsMs || tsToMillis(r.timestamp);
        return ms >= fromMs && ms <= toMs;
      });
    }
    if (filterComment) {
      const q = filterComment.toLowerCase();
      list = list.filter((r) => (r.comments || "").toLowerCase().includes(q));
    }

    // Missing values always sink to bottom regardless of sort direction.
    list.sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey];
      const aMiss = isMissing(av);
      const bMiss = isMissing(bv);
      if (aMiss && bMiss) return 0;
      if (aMiss) return 1;
      if (bMiss) return -1;
      return sortDir === "asc" ? cmp(av, bv) : cmp(bv, av);
    });
    return list;
  }, [data, filterJuror, filterGroup, filterDept, filterStatuses, filterEditing, dateFrom, dateTo,
      filterComment, sortKey, sortDir]);

  function setSort(key) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("desc"); }
  }
  const numericSortKeys = useMemo(
    () => new Set(SCORE_COLS.map(({ key }) => key)),
    []
  );
  const sortIcon = (key) => {
    if (sortKey !== key) return <ArrowUpDownIcon />;
    if (numericSortKeys.has(key)) return sortDir === "asc" ? <ArrowDown01Icon /> : <ArrowDown10Icon />;
    return sortDir === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />;
  };

  const popoverConfig = (() => {
    if (activeFilterCol === "juror") {
      return {
        className: "col-filter-popover col-filter-popover-portal",
        contentKey: filterJuror,
        content: (
          <>
            <select
              autoFocus
              value={filterJuror}
              onChange={(e) => { setFilterJuror(e.target.value); closePopover(); }}
              className={isJurorFilterActive ? "filter-input-active" : ""}
            >
              <option value="ALL">All jurors</option>
              {jurors.map((j) => (
                <option key={j.key} value={j.key}>
                  {j.name}{j.dept ? ` (${j.dept})` : ""}
                </option>
              ))}
            </select>
            {filterJuror !== "ALL" && (
              <button className="col-filter-clear" onClick={() => { setFilterJuror("ALL"); closePopover(); }}>
                Clear
              </button>
            )}
          </>
        ),
      };
    }
    if (activeFilterCol === "dept") {
      return {
        className: "col-filter-popover col-filter-popover-portal",
        contentKey: filterDept,
        content: (
          <>
            <select
              autoFocus
              value={filterDept}
              onChange={(e) => { setFilterDept(e.target.value); closePopover(); }}
              className={isDeptFilterActive ? "filter-input-active" : ""}
            >
              <option value="ALL">All departments</option>
              {deptOptions.map((d) => (
                <option key={d.key} value={d.key}>{d.label}</option>
              ))}
            </select>
            {filterDept !== "ALL" && (
              <button className="col-filter-clear" onClick={() => { setFilterDept("ALL"); closePopover(); }}>
                Clear
              </button>
            )}
          </>
        ),
      };
    }
    if (activeFilterCol === "group") {
      return {
        className: "col-filter-popover col-filter-popover-portal",
        contentKey: filterGroup,
        content: (
          <>
            <select
              autoFocus
              value={filterGroup}
              onChange={(e) => { setFilterGroup(e.target.value); closePopover(); }}
              className={isGroupFilterActive ? "filter-input-active" : ""}
            >
              <option value="ALL">All groups</option>
              {groups.map((g) => (
                <option key={g.id} value={String(g.id)}>{g.label}</option>
              ))}
            </select>
            {filterGroup !== "ALL" && (
              <button className="col-filter-clear" onClick={() => { setFilterGroup("ALL"); closePopover(); }}>
                Clear
              </button>
            )}
          </>
        ),
      };
    }
    if (activeFilterCol === "timestamp") {
      const handleFromChange = (val) => {
        setDateFrom(val);
      };
      const handleToChange = (val) => {
        setDateTo(val);
      };
      const handleDateBlur = () => {
        if ((dateFrom && parsedFromMs === null) || (dateTo && parsedToMs === null)) {
          setDateError("Invalid date format.");
          return;
        }
        if (isInvalidRange) {
          setDateError("The 'From' date cannot be later than the 'To' date.");
        } else {
          setDateError(null);
        }
      };
      return {
        className: `col-filter-popover col-filter-popover-portal col-filter-popover-timestamp${isMobile ? " is-centered" : ""}`,
        contentKey: `${dateFrom}|${dateTo}`,
        mode: isMobile ? "center" : "anchor",
        content: (
          <>
            <div className="timestamp-field">
              <label>From</label>
              <input
                autoFocus
                type="date"
                placeholder="YYYY-MM-DD"
                value={dateFrom}
                onChange={(e) => handleFromChange(e.target.value)}
                onBlur={handleDateBlur}
                className={`timestamp-date-input ${dateError ? "is-invalid " : ""}${isDateFilterActive ? "filter-input-active" : ""}`}
                aria-invalid={!!dateError}
              />
            </div>
            <div className="timestamp-field">
              <label>To</label>
              <input
                type="date"
                placeholder="YYYY-MM-DD"
                value={dateTo}
                onChange={(e) => handleToChange(e.target.value)}
                onBlur={handleDateBlur}
                className={`timestamp-date-input ${dateError ? "is-invalid " : ""}${isDateFilterActive ? "filter-input-active" : ""}`}
                aria-invalid={!!dateError}
              />
            </div>
            {dateError && (
              <div className="timestamp-error" role="alert">
                {dateError}
              </div>
            )}
            {isMobile ? (
              <div className="timestamp-actions">
                {(dateFrom || dateTo) && (
                  <button className="col-filter-clear" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                    Clear
                  </button>
                )}
                <button className="timestamp-done-btn" onClick={closePopover} disabled={!!dateError}>
                  Done
                </button>
              </div>
            ) : (
              (dateFrom || dateTo) && (
                <button className="col-filter-clear" onClick={() => { setDateFrom(""); setDateTo(""); }}>
                  Clear
                </button>
              )
            )}
          </>
        ),
      };
    }
    if (activeFilterCol === "status") {
      return {
        className: "col-filter-popover col-filter-popover-portal col-filter-popover-status",
        contentKey: Array.from(filterStatuses).sort().join("|"),
        content: (
          <>
            {STATUS_OPTIONS.map(({ key, label }) => (
              <label key={key} className="status-option">
                <input
                  type="checkbox"
                  checked={filterStatuses.has(key)}
                  onChange={() => toggleStatus(key)}
                />
                {label}
              </label>
            ))}
            {filterStatuses.size > 0 && (
              <button className="col-filter-clear" onClick={() => { setFilterStatuses(new Set()); closePopover(); }}>
                Clear
              </button>
            )}
          </>
        ),
      };
    }
    if (activeFilterCol === "editing") {
      return {
        className: "col-filter-popover col-filter-popover-portal",
        contentKey: filterEditing,
        content: (
          <>
            <select
              autoFocus
              value={filterEditing}
              onChange={(e) => { setFilterEditing(e.target.value); closePopover(); }}
              className={isEditingFilterActive ? "filter-input-active" : ""}
            >
              <option value="ALL">All</option>
              <option value="editing">Editing only</option>
              <option value="not_editing">Not editing</option>
            </select>
            {filterEditing !== "ALL" && (
              <button className="col-filter-clear" onClick={() => { setFilterEditing("ALL"); closePopover(); }}>
                Clear
              </button>
            )}
          </>
        ),
      };
    }
    if (activeFilterCol === "comments") {
      return {
        className: "col-filter-popover col-filter-popover-portal",
        contentKey: filterComment,
        content: (
          <>
            <input
              autoFocus
              placeholder="Search comments…"
              value={filterComment}
              onChange={(e) => setFilterComment(e.target.value)}
              className={isCommentFilterActive ? "filter-input-active" : ""}
            />
            {filterComment && (
              <button className="col-filter-clear" onClick={() => { setFilterComment(""); closePopover(); }}>
                Clear
              </button>
            )}
          </>
        ),
      };
    }
    return null;
  })();

  return (
    <>
      {/* Compact toolbar: row count + clear + export */}
      <div className="detail-table-toolbar">
        <span className="filter-count">
          Showing <strong>{rows.length}</strong> row{rows.length !== 1 ? "s" : ""}
        </span>
        {hasAnyFilter && (
          <>
            <span className="filters-active-pill">Filters: {activeFilterCount}</span>
            <button
              type="button"
              className="filters-clear-btn"
              onClick={resetFilters}
              aria-label="Clear filters"
              title="Clear filters"
            >
              <XIcon />
            </button>
          </>
        )}
        <button className="xlsx-export-btn" onClick={() => { void exportXLSX(rows); }}>
          <DownloadIcon />
          <span className="export-label-long">Export Excel</span>
          <span className="export-label-short">Excel</span>
        </button>
      </div>

      <FilterPopoverPortal
        open={!!popoverConfig}
        anchorRect={anchorRect}
        anchorEl={anchorEl}
        onClose={closePopover}
        className={popoverConfig?.className}
        contentKey={popoverConfig?.contentKey}
        mode={popoverConfig?.mode}
      >
        {popoverConfig?.content}
      </FilterPopoverPortal>

      {/* Table */}
      <div className="detail-table-wrap">
        <table className="detail-table">
          <thead>
            <tr>
              {/* Juror — sort label + filter hotspot */}
              <th style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span
                    className={`col-sort-label details-col-label${isJurorFilterActive ? " filtered" : ""}`}
                    onClick={() => setSort("juryName")}
                  >
                    Juror
                  </span>
                  <button
                    type="button"
                    className={`col-filter-hotspot${isJurorFilterActive ? " active filter-icon-active" : ""}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFilterCol("juror", e); }}
                    title="Filter by juror"
                  >
                    <FilterIcon />
                  </button>
                </div>
              </th>

              {/* Department */}
              <th style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span
                    className={`col-sort-label details-col-label${isDeptFilterActive ? " filtered" : ""}`}
                    onClick={() => setSort("juryDept")}
                  >
                    Department
                  </span>
                  <button
                    type="button"
                    className={`col-filter-hotspot${isDeptFilterActive ? " active filter-icon-active" : ""}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFilterCol("dept", e); }}
                    title="Filter by department"
                  >
                    <FilterIcon />
                  </button>
                </div>
              </th>

              {/* Group */}
              <th style={{ position: "relative", whiteSpace: "nowrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span
                    className={`col-sort-label details-col-label${isGroupFilterActive ? " filtered" : ""}`}
                    onClick={() => setSort("projectId")}
                  >
                    Group
                  </span>
                  <button
                    type="button"
                    className={`col-filter-hotspot${isGroupFilterActive ? " active filter-icon-active" : ""}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFilterCol("group", e); }}
                    title="Filter by group"
                  >
                    <FilterIcon />
                  </button>
                </div>
              </th>

              {/* Timestamp */}
              <th style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span
                    className={`col-sort-label details-col-label${isDateFilterActive ? " filtered" : ""}`}
                    onClick={() => setSort("tsMs")}
                  >
                    Timestamp
                  </span>
                  <button
                    type="button"
                    className={`col-filter-hotspot${isDateFilterActive ? " active filter-icon-active" : ""}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFilterCol("timestamp", e); }}
                    title="Filter by date"
                  >
                    <FilterIcon />
                  </button>
                </div>
              </th>

              {/* Status — filter only (no sort) */}
              <th style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span
                    className={`col-sort-label details-col-label${isStatusFilterActive ? " filtered" : ""}`}
                    onClick={() => setSort("status")}
                  >
                    Status
                  </span>
                  <button
                    type="button"
                    className={`col-filter-hotspot${isStatusFilterActive ? " active filter-icon-active" : ""}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFilterCol("status", e); }}
                    title="Filter by status"
                  >
                    <FilterIcon />
                  </button>
                </div>
              </th>
              <th style={{ position: "relative", textAlign: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2, justifyContent: "center" }}>
                  <span className={`details-col-label${isEditingFilterActive ? " filtered" : ""}`}>
                    Editing
                  </span>
                  <button
                    type="button"
                    className={`col-filter-hotspot${isEditingFilterActive ? " active filter-icon-active" : ""}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFilterCol("editing", e); }}
                    title="Filter by editing"
                  >
                    <FilterIcon />
                  </button>
                </div>
              </th>

              {/* Score columns — sort only, no filter */}
              {SCORE_COLS.map(({ key: col, label }) => (
                <th key={col} style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => setSort(col)}>
                  <span className={`col-sort-label details-col-label${sortKey === col ? " filtered" : ""}`}>
                    {label} <span className={`sort-icon${sortKey === col ? " icon-active-box" : ""}`}>{sortIcon(col)}</span>
                  </span>
                </th>
              ))}

              {/* Comments — filter only (no sort) */}
              <th style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span className={`details-col-label${isCommentFilterActive ? " filtered" : ""}`}>
                    Comments
                  </span>
                  <button
                    type="button"
                    className={`col-filter-hotspot${isCommentFilterActive ? " active filter-icon-active" : ""}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFilterCol("comments", e); }}
                    title="Filter by comments"
                  >
                    <FilterIcon />
                  </button>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={12} style={{ textAlign: "center", padding: 32, color: "#64748b" }}>
                  No matching rows.
                </td>
              </tr>
            )}
            {rows.map((row, i) => {
              const grp = PROJECT_LIST.find((p) => p.id === row.projectId);
              const isIP = row.status === "in_progress";
              return (
                <tr
                  key={`${rowKey(row)}-${row.projectId}-${i}`}
                  className={i % 2 === 1 ? "row-even" : ""}
                >
                  <td className="cell-juror">{row.juryName}</td>
                  <td className="cell-dept" style={{ fontSize: 12, color: "#475569" }}>{row.juryDept}</td>
                  <td className="cell-group" style={{ whiteSpace: "nowrap" }}>
                    <div
                      className="cell-group-wrap"
                      title={`Group ${row.projectId}`}
                      style={{ cursor: "default" }}
                    >
                      <strong className="cell-group-title">Group {row.projectId}</strong>
                    </div>
                  </td>
                  <td style={{ fontSize: 12, color: "#475569", whiteSpace: "nowrap" }}>
                    {formatTs(row.timestamp)}
                  </td>
                  <td><StatusBadge status={row.status} /></td>
                  <td>{row.editingFlag === "editing" ? <StatusBadge editingFlag="editing" /> : null}</td>
                  <td style={{ color: isIP ? "#94a3b8" : undefined }}>{displayScore(row.technical)}</td>
                  <td style={{ color: isIP ? "#94a3b8" : undefined }}>{displayScore(row.design)}</td>
                  <td style={{ color: isIP ? "#94a3b8" : undefined }}>{displayScore(row.delivery)}</td>
                  <td style={{ color: isIP ? "#94a3b8" : undefined }}>{displayScore(row.teamwork)}</td>
                  <td style={{ color: isIP ? "#94a3b8" : undefined }}>
                    <strong>{displayScore(row.total)}</strong>
                  </td>
                  <td className="comment-cell cell-comment">{row.comments}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
