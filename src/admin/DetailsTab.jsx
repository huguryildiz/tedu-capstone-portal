// src/admin/DetailsTab.jsx
// ============================================================
// Sortable details table with Excel-style column header filters.
// ============================================================

import { useEffect, useMemo, useState } from "react";
import { cmp, exportXLSX, formatTs, tsToMillis, rowKey } from "./utils";
import { readSection, writeSection } from "./persist";
import { FilterPopoverPortal, StatusBadge } from "./components";
import { FilterIcon, DownloadIcon, ArrowUpDownIcon, ArrowDown01Icon, ArrowDown10Icon, ArrowDownIcon, ArrowUpIcon, XIcon } from "../shared/Icons";

// Show "" for null/undefined/empty/NaN.  0 is a valid score.
function displayScore(val) {
  if (val === "" || val === null || val === undefined) return "";
  if (typeof val === "string" && val.trim() === "") return "";
  const n = Number(val);
  if (!Number.isFinite(n)) return "";
  return n;
}

const SCORE_COLS = [
  { key: "technical", label: "Technical /30" },
  { key: "design",    label: "Written /30"   },
  { key: "delivery",  label: "Oral /30"      },
  { key: "teamwork",  label: "Teamwork /10"  },
  { key: "total",     label: "Total"         },
];

// jurors prop: { key, name, dept }[]
export default function DetailsTab({ data, jurors, semesterName = "", summaryData = [] }) {
  const VALID_SORT_DIRS = ["asc", "desc"];
  const [filterSemester, setFilterSemester] = useState(() => { const s = readSection("details"); return typeof s.filterSemester === "string" ? s.filterSemester : ""; });
  const [filterGroupNo,  setFilterGroupNo]  = useState(() => { const s = readSection("details"); return typeof s.filterGroupNo  === "string" ? s.filterGroupNo  : ""; });
  const [filterJuror,    setFilterJuror]    = useState(() => { const s = readSection("details"); return typeof s.filterJuror  === "string" ? s.filterJuror  : "ALL"; });
  const [filterDept,     setFilterDept]     = useState(() => { const s = readSection("details"); return typeof s.filterDept   === "string" ? s.filterDept   : "ALL"; });
  const [filterStatus,   setFilterStatus]   = useState(() => { const s = readSection("details"); return typeof s.filterStatus === "string" ? s.filterStatus : "ALL"; });
  const [filterProjectTitle, setFilterProjectTitle] = useState(() => { const s = readSection("details"); return typeof s.filterProjectTitle === "string" ? s.filterProjectTitle : ""; });
  const [filterStudents,     setFilterStudents]     = useState(() => { const s = readSection("details"); return typeof s.filterStudents     === "string" ? s.filterStudents     : ""; });
  const [dateFrom,       setDateFrom]       = useState(() => { const s = readSection("details"); return typeof s.dateFrom     === "string" ? s.dateFrom     : ""; });
  const [dateTo,         setDateTo]         = useState(() => { const s = readSection("details"); return typeof s.dateTo       === "string" ? s.dateTo       : ""; });
  const [dateError,      setDateError]      = useState(null);
  const jurorEditMap = useMemo(() => {
    const map = new Map();
    (jurors || []).forEach((j) => {
      const editEnabled = !!(j.editEnabled ?? j.edit_enabled);
      if (j.jurorId) map.set(j.jurorId, editEnabled);
      if (j.key) map.set(j.key, editEnabled);
      const name = String(j.name ?? j.juryName ?? "").trim().toLowerCase();
      const dept = String(j.dept ?? j.juryDept ?? "").trim().toLowerCase();
      if (name || dept) map.set(`${name}__${dept}`, editEnabled);
    });
    return map;
  }, [jurors]);
  const [filterComment,  setFilterComment]  = useState(() => { const s = readSection("details"); return typeof s.filterComment === "string" ? s.filterComment : ""; });
  const [sortKey,        setSortKey]        = useState(() => {
    const s = readSection("details");
    const key = typeof s.sortKey === "string" && s.sortKey ? s.sortKey : "tsMs";
    return key === "projectId" ? "projectTitle" : key;
  });
  const [sortDir,        setSortDir]        = useState(() => { const s = readSection("details"); return VALID_SORT_DIRS.includes(s.sortDir) ? s.sortDir : "desc"; });
  const [activeFilterCol, setActiveFilterCol] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const [anchorEl, setAnchorEl] = useState(null);
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== "undefined" && window.matchMedia("(max-width: 480px)").matches
  ));

  const projectMetaById = useMemo(
    () => new Map((summaryData || []).map((p) => [p.id, { title: p?.name ?? "", students: p?.students ?? "" }])),
    [summaryData]
  );
  const semesterOptions = useMemo(() => {
    const map = new Map();
    const add = (val) => {
      const label = String(val ?? "").trim();
      if (!label) return;
      map.set(label.toLowerCase(), label);
    };
    data.forEach((row) => add(row?.semester));
    add(semesterName);
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1], "tr"))
      .map(([, label]) => label);
  }, [data, semesterName]);
  const groupNoOptions = useMemo(() => {
    const map = new Map();
    data.forEach((row) => {
      const label = String(row?.groupNo ?? "").trim();
      if (!label) return;
      map.set(label.toLowerCase(), label);
    });
    return Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1], "tr", { numeric: true }))
      .map(([, label]) => label);
  }, [data]);
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
      filterSemester, filterGroupNo, filterJuror, filterDept, filterProjectTitle, filterStudents,
      filterStatus, dateFrom, dateTo, filterComment,
      sortKey, sortDir,
    });
  }, [filterSemester, filterGroupNo, filterJuror, filterDept, filterStatus, filterProjectTitle, filterStudents, dateFrom, dateTo, filterComment, sortKey, sortDir]);

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
    if (filterSemester) count += 1;
    if (filterGroupNo) count += 1;
    if (filterJuror !== "ALL") count += 1;
    if (filterDept !== "ALL") count += 1;
    if (filterStatus !== "ALL") count += 1;
    if (filterProjectTitle) count += 1;
    if (filterStudents) count += 1;
    if (dateFrom || dateTo) count += 1;
    if (filterComment) count += 1;
    return count;
  }, [filterSemester, filterGroupNo, filterJuror, filterDept, filterStatus, filterProjectTitle, filterStudents, dateFrom, dateTo, filterComment]);
  const hasAnyFilter = activeFilterCount > 0;
  const isSemesterFilterActive = !!filterSemester || activeFilterCol === "semester";
  const isGroupNoFilterActive = !!filterGroupNo || activeFilterCol === "groupNo";
  const isJurorFilterActive = filterJuror !== "ALL" || activeFilterCol === "juror";
  const isDeptFilterActive = filterDept !== "ALL" || activeFilterCol === "dept";
  const isStatusFilterActive = filterStatus !== "ALL" || activeFilterCol === "status";
  const isProjectTitleFilterActive = !!filterProjectTitle || activeFilterCol === "projectTitle";
  const isStudentsFilterActive = !!filterStudents || activeFilterCol === "students";
  const isDateFilterActive = !!dateFrom || !!dateTo || activeFilterCol === "timestamp";
  const isCommentFilterActive = !!filterComment || activeFilterCol === "comments";

  function resetFilters() {
    setFilterSemester("");
    setFilterGroupNo("");
    setFilterJuror("ALL");
    setFilterDept("ALL");
    setFilterStatus("ALL");
    setFilterProjectTitle("");
    setFilterStudents("");
    setDateFrom("");
    setDateTo("");
    setDateError(null);
    setFilterComment("");
    setSortKey("tsMs");
    setSortDir("desc");
    setActiveFilterCol(null);
    setAnchorRect(null);
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

    let list = data.map((row) => {
      const meta = projectMetaById.get(row.projectId);
      const projectTitle = String(row.projectName ?? meta?.title ?? "").trim();
      const studentsRaw = row.students ?? meta?.students ?? "";
      const students = Array.isArray(studentsRaw)
        ? studentsRaw.map((s) => String(s).trim()).filter(Boolean).join(", ")
        : String(studentsRaw).trim();
      const isEditing = !!(jurorEditMap.get(row.jurorId) || jurorEditMap.get(rowKey(row)));
      const effectiveStatus = isEditing
        ? "editing"
        : (row.status === "submitted" ? "submitted" : (row.status === "in_progress" ? "in_progress" : "not_started"));
      return {
        ...row,
        semester: semesterName ?? "",
        projectTitle,
        students,
        isEditing,
        effectiveStatus,
      };
    });

    if (filterSemester) {
      const q = filterSemester.toLowerCase();
      list = list.filter((r) => String(r.semester || "").trim().toLowerCase() === q);
    }
    if (filterGroupNo) {
      const q = filterGroupNo.toLowerCase();
      list = list.filter((r) => String(r.groupNo ?? "").trim().toLowerCase() === q);
    }
    if (filterJuror !== "ALL") {
      list = list.filter((r) => rowKey(r) === filterJuror);
    }
    if (filterDept !== "ALL") {
      const q = filterDept.toLowerCase();
      list = list.filter((r) => String(r.juryDept ?? "").trim().toLowerCase() === q);
    }
    if (filterStatus !== "ALL") {
      list = list.filter((r) => r.effectiveStatus === filterStatus);
    }
    if (filterProjectTitle) {
      const q = filterProjectTitle.toLowerCase();
      list = list.filter((r) => (r.projectTitle || "").toLowerCase().includes(q));
    }
    if (filterStudents) {
      const q = filterStudents.toLowerCase();
      list = list.filter((r) => (r.students || "").toLowerCase().includes(q));
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
  }, [data, projectMetaById, semesterName, filterSemester, filterGroupNo, filterJuror, filterDept, filterStatus, filterProjectTitle, filterStudents,
      dateFrom, dateTo, filterComment, sortKey, sortDir, jurorEditMap]);

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
    if (activeFilterCol === "semester") {
      return {
        className: "col-filter-popover col-filter-popover-portal",
        contentKey: filterSemester,
        content: (
          <>
            <select
              autoFocus
              value={filterSemester}
              onChange={(e) => { setFilterSemester(e.target.value); closePopover(); }}
              className={isSemesterFilterActive ? "filter-input-active" : ""}
            >
              <option value="">All semesters</option>
              {semesterOptions.map((label) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
            {filterSemester && (
              <button className="col-filter-clear" onClick={() => { setFilterSemester(""); closePopover(); }}>
                Clear
              </button>
            )}
          </>
        ),
      };
    }
    if (activeFilterCol === "groupNo") {
      return {
        className: "col-filter-popover col-filter-popover-portal",
        contentKey: filterGroupNo,
        content: (
          <>
            <select
              autoFocus
              value={filterGroupNo}
              onChange={(e) => { setFilterGroupNo(e.target.value); closePopover(); }}
              className={isGroupNoFilterActive ? "filter-input-active" : ""}
            >
              <option value="">All groups</option>
              {groupNoOptions.map((label) => (
                <option key={label} value={label}>{label}</option>
              ))}
            </select>
            {filterGroupNo && (
              <button className="col-filter-clear" onClick={() => { setFilterGroupNo(""); closePopover(); }}>
                Clear
              </button>
            )}
          </>
        ),
      };
    }
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
    if (activeFilterCol === "status") {
      return {
        className: "col-filter-popover col-filter-popover-portal",
        contentKey: filterStatus,
        content: (
          <>
            <select
              autoFocus
              value={filterStatus}
              onChange={(e) => { setFilterStatus(e.target.value); closePopover(); }}
              className={isStatusFilterActive ? "filter-input-active" : ""}
            >
              <option value="ALL">All statuses</option>
              <option value="editing">Editing</option>
              <option value="submitted">Submitted</option>
              <option value="in_progress">In Progress</option>
              <option value="not_started">Not started</option>
            </select>
            {filterStatus !== "ALL" && (
              <button className="col-filter-clear" onClick={() => { setFilterStatus("ALL"); closePopover(); }}>
                Clear
              </button>
            )}
          </>
        ),
      };
    }
    if (activeFilterCol === "projectTitle") {
      return {
        className: "col-filter-popover col-filter-popover-portal",
        contentKey: filterProjectTitle,
        content: (
          <>
            <input
              autoFocus
              placeholder="Search project title…"
              value={filterProjectTitle}
              onChange={(e) => setFilterProjectTitle(e.target.value)}
              className={isProjectTitleFilterActive ? "filter-input-active" : ""}
            />
            {filterProjectTitle && (
              <button className="col-filter-clear" onClick={() => { setFilterProjectTitle(""); closePopover(); }}>
                Clear
              </button>
            )}
          </>
        ),
      };
    }
    if (activeFilterCol === "students") {
      return {
        className: "col-filter-popover col-filter-popover-portal",
        contentKey: filterStudents,
        content: (
          <>
            <input
              autoFocus
              placeholder="Search students…"
              value={filterStudents}
              onChange={(e) => setFilterStudents(e.target.value)}
              className={isStudentsFilterActive ? "filter-input-active" : ""}
            />
            {filterStudents && (
              <button className="col-filter-clear" onClick={() => { setFilterStudents(""); closePopover(); }}>
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
        <button className="xlsx-export-btn" onClick={() => { void exportXLSX(rows, { semesterName, summaryData }); }}>
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
              {/* Semester */}
              <th style={{ position: "relative", whiteSpace: "nowrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span
                    className={`col-sort-label details-col-label${isSemesterFilterActive ? " filtered" : ""}`}
                    onClick={() => setSort("semester")}
                  >
                    Semester
                  </span>
                  <button
                    type="button"
                    className={`col-filter-hotspot${isSemesterFilterActive ? " active filter-icon-active" : ""}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFilterCol("semester", e); }}
                    title="Filter by semester"
                  >
                    <FilterIcon />
                  </button>
                </div>
              </th>

              {/* Group No */}
              <th style={{ position: "relative", whiteSpace: "nowrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span
                    className={`col-sort-label details-col-label${isGroupNoFilterActive ? " filtered" : ""}`}
                    onClick={() => setSort("groupNo")}
                  >
                    Group No
                  </span>
                  <button
                    type="button"
                    className={`col-filter-hotspot${isGroupNoFilterActive ? " active filter-icon-active" : ""}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFilterCol("groupNo", e); }}
                    title="Filter by group no"
                  >
                    <FilterIcon />
                  </button>
                </div>
              </th>

              {/* Project Title */}
              <th style={{ position: "relative", whiteSpace: "nowrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span
                    className={`col-sort-label details-col-label${isProjectTitleFilterActive ? " filtered" : ""}`}
                    onClick={() => setSort("projectTitle")}
                  >
                    Project Title
                  </span>
                  <button
                    type="button"
                    className={`col-filter-hotspot${isProjectTitleFilterActive ? " active filter-icon-active" : ""}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFilterCol("projectTitle", e); }}
                    title="Filter by project title"
                  >
                    <FilterIcon />
                  </button>
                </div>
              </th>

              {/* Group Students */}
              <th style={{ position: "relative", whiteSpace: "nowrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span
                    className={`col-sort-label details-col-label${isStudentsFilterActive ? " filtered" : ""}`}
                    onClick={() => setSort("students")}
                  >
                    Group Students
                  </span>
                  <button
                    type="button"
                    className={`col-filter-hotspot${isStudentsFilterActive ? " active filter-icon-active" : ""}`}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleFilterCol("students", e); }}
                    title="Filter by students"
                  >
                    <FilterIcon />
                  </button>
                </div>
              </th>

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

              {/* Status */}
              <th style={{ position: "relative", whiteSpace: "nowrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span className={`details-col-label${isStatusFilterActive ? " filtered" : ""}`}>
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

              {/* Score columns — sort only, no filter */}
              {SCORE_COLS.map(({ key: col, label }) => (
                <th key={col} style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => setSort(col)}>
                  <span className={`col-sort-label details-col-label${sortKey === col ? " filtered" : ""}`}>
                    {label} <span className={`sort-icon${sortKey === col ? " icon-active-box" : ""}`}>{sortIcon(col)}</span>
                  </span>
                </th>
              ))}

              {/* Submitted At */}
              <th style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span
                    className={`col-sort-label details-col-label${isDateFilterActive ? " filtered" : ""}`}
                    onClick={() => setSort("tsMs")}
                  >
                    Submitted At
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

              {/* Comment — filter only (no sort) */}
              <th style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span className={`details-col-label${isCommentFilterActive ? " filtered" : ""}`}>
                    Comment
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
                <td colSpan={14} style={{ textAlign: "center", padding: 32, color: "#64748b" }}>
                  No matching rows.
                </td>
              </tr>
            )}
            {rows.map((row, i) => {
              const isIP = row.status === "in_progress";
              const isEditing = row.isEditing;
              const projectTitle = row.projectTitle || "";
              const students = row.students || "";
              return (
                <tr
                  key={`${rowKey(row)}-${row.projectId}-${i}`}
                  className={i % 2 === 1 ? "row-even" : ""}
                >
                  <td className="cell-semester" style={{ whiteSpace: "nowrap" }}>
                    {row.semester ? row.semester : "—"}
                  </td>
                  <td className="cell-group-no" style={{ whiteSpace: "nowrap" }}>
                    {row.groupNo ?? "—"}
                  </td>
                  <td className="cell-project-title" style={{ whiteSpace: "nowrap" }}>
                    {projectTitle ? projectTitle : "—"}
                  </td>
                  <td className="cell-students" style={{ whiteSpace: "nowrap" }}>
                    {students ? students : "—"}
                  </td>
                  <td className="cell-juror">{row.juryName}</td>
                  <td className="cell-dept" style={{ fontSize: 12, color: "#475569" }}>{row.juryDept}</td>
                  <td className="cell-status">
                    <StatusBadge
                      status={row.status === "submitted" ? "submitted" : "in_progress"}
                      editingFlag={isEditing ? "editing" : null}
                    />
                  </td>
                  <td style={{ color: isIP ? "#94a3b8" : undefined }}>{displayScore(row.technical)}</td>
                  <td style={{ color: isIP ? "#94a3b8" : undefined }}>{displayScore(row.design)}</td>
                  <td style={{ color: isIP ? "#94a3b8" : undefined }}>{displayScore(row.delivery)}</td>
                  <td style={{ color: isIP ? "#94a3b8" : undefined }}>{displayScore(row.teamwork)}</td>
                  <td style={{ color: isIP ? "#94a3b8" : undefined }}>
                    <strong>{displayScore(row.total)}</strong>
                  </td>
                  <td style={{ fontSize: 12, color: "#475569", whiteSpace: "nowrap" }}>
                    {formatTs(row.timestamp)}
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
