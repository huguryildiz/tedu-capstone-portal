// src/admin/DetailsTab.jsx
// ============================================================
// Sortable details table with Excel-style column header filters.
// ============================================================

import { useEffect, useMemo, useRef, useState } from "react";
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
const STATUS_OPTIONS = [
  { value: "editing",     label: "Editing" },
  { value: "submitted",   label: "Submitted" },
  { value: "in_progress", label: "In Progress" },
  { value: "not_started", label: "Not started" },
];

// jurors prop: { key, name, dept }[]
export default function DetailsTab({
  data,
  jurors,
  assignedJurors = null,
  groups = [],
  semesterName = "",
  summaryData = [],
}) {
  const VALID_SORT_DIRS = ["asc", "desc"];
  const [filterSemester, setFilterSemester] = useState(() => { const s = readSection("details"); return typeof s.filterSemester === "string" ? s.filterSemester : ""; });
  const [filterGroupNo,  setFilterGroupNo]  = useState(() => {
    const s = readSection("details");
    if (Array.isArray(s.filterGroupNo)) return s.filterGroupNo;
    if (typeof s.filterGroupNo === "string" && s.filterGroupNo) return [s.filterGroupNo];
    return [];
  });
  const [filterJuror,    setFilterJuror]    = useState(() => {
    const s = readSection("details");
    if (typeof s.filterJuror === "string") return s.filterJuror === "ALL" ? "" : s.filterJuror;
    return "";
  });
  const [filterDept,     setFilterDept]     = useState(() => {
    const s = readSection("details");
    if (typeof s.filterDept === "string") return s.filterDept === "ALL" ? "" : s.filterDept;
    return "";
  });
  const [filterStatus,   setFilterStatus]   = useState(() => {
    const s = readSection("details");
    if (Array.isArray(s.filterStatus)) return s.filterStatus;
    if (typeof s.filterStatus === "string" && s.filterStatus && s.filterStatus !== "ALL") return [s.filterStatus];
    return [];
  });
  const [filterProjectTitle, setFilterProjectTitle] = useState(() => { const s = readSection("details"); return typeof s.filterProjectTitle === "string" ? s.filterProjectTitle : ""; });
  const [filterStudents,     setFilterStudents]     = useState(() => { const s = readSection("details"); return typeof s.filterStudents     === "string" ? s.filterStudents     : ""; });
  const [dateFrom,       setDateFrom]       = useState(() => { const s = readSection("details"); return typeof s.dateFrom     === "string" ? s.dateFrom     : ""; });
  const [dateTo,         setDateTo]         = useState(() => { const s = readSection("details"); return typeof s.dateTo       === "string" ? s.dateTo       : ""; });
  const [dateFilterCol,  setDateFilterCol]  = useState(() => { const s = readSection("details"); return s.dateFilterCol === "completed" ? "completed" : "updated"; });
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
    const rawKey = typeof s.sortKey === "string" && s.sortKey ? s.sortKey : "updatedMs";
    const key = rawKey === "tsMs" ? "updatedMs" : rawKey;
    return key === "projectId" ? "projectTitle" : key;
  });
  const [sortDir,        setSortDir]        = useState(() => { const s = readSection("details"); return VALID_SORT_DIRS.includes(s.sortDir) ? s.sortDir : "desc"; });
  const [activeFilterCol, setActiveFilterCol] = useState(null);
  const [anchorRect, setAnchorRect] = useState(null);
  const [anchorEl, setAnchorEl] = useState(null);
  const [isMobile, setIsMobile] = useState(() => (
    typeof window !== "undefined" && window.matchMedia("(max-width: 480px)").matches
  ));
  const topScrollRef = useRef(null);
  const tableScrollRef = useRef(null);

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
  useEffect(() => {
    if (!isMobile) return;
    if (activeFilterCol !== "timestamp" && activeFilterCol !== "finalSubmittedAt") return;
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
    const top = topScrollRef.current;
    const wrap = tableScrollRef.current;
    if (!top || !wrap) return;

    const inner = top.firstElementChild;
    if (!inner) return;

    let syncing = false;
    const syncFromWrap = () => {
      if (syncing) return;
      syncing = true;
      top.scrollLeft = wrap.scrollLeft;
      syncing = false;
    };
    const syncFromTop = () => {
      if (syncing) return;
      syncing = true;
      wrap.scrollLeft = top.scrollLeft;
      syncing = false;
    };
    const updateWidth = () => {
      inner.style.width = `${wrap.scrollWidth}px`;
      syncFromWrap();
    };

    updateWidth();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(updateWidth) : null;
    ro?.observe(wrap);
    window.addEventListener("resize", updateWidth);
    wrap.addEventListener("scroll", syncFromWrap, { passive: true });
    top.addEventListener("scroll", syncFromTop, { passive: true });

    return () => {
      wrap.removeEventListener("scroll", syncFromWrap);
      top.removeEventListener("scroll", syncFromTop);
      window.removeEventListener("resize", updateWidth);
      ro?.disconnect();
    };
  }, []);

  useEffect(() => {
    writeSection("details", {
      filterSemester, filterGroupNo, filterJuror, filterDept, filterProjectTitle, filterStudents,
      filterStatus, dateFrom, dateTo, dateFilterCol, filterComment,
      sortKey, sortDir,
    });
  }, [filterSemester, filterGroupNo, filterJuror, filterDept, filterStatus, filterProjectTitle, filterStudents, dateFrom, dateTo, dateFilterCol, filterComment, sortKey, sortDir]);

  function isValidDateParts(yyyy, mm, dd) {
    if (yyyy < 2000 || yyyy > 2100) return false;
    if (mm < 1 || mm > 12) return false;
    if (dd < 1) return false;
    const maxDays = new Date(yyyy, mm, 0).getDate();
    return dd <= maxDays;
  }

  function isValidTimeParts(hh, mi, ss) {
    if (hh < 0 || hh > 23) return false;
    if (mi < 0 || mi > 59) return false;
    if (ss < 0 || ss > 59) return false;
    return true;
  }

  function parseDateString(value) {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) {
      const [datePart, timePart] = value.split("T");
      const [yyyy, mm, dd] = datePart.split("-").map(Number);
      const [hh, mi, ss = "0"] = timePart.split(":").map(Number);
      if (!isValidDateParts(yyyy, mm, dd)) return null;
      if (!isValidTimeParts(hh, mi, ss)) return null;
      return { ms: new Date(yyyy, mm - 1, dd, hh, mi, ss).getTime(), isDateOnly: false };
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const [yyyy, mm, dd] = value.split("-").map(Number);
      if (!isValidDateParts(yyyy, mm, dd)) return null;
      return { ms: new Date(yyyy, mm - 1, dd).getTime(), isDateOnly: true };
    }
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
      const [dd, mm, yyyy] = value.split("/").map(Number);
      if (!isValidDateParts(yyyy, mm, dd)) return null;
      return { ms: new Date(yyyy, mm - 1, dd).getTime(), isDateOnly: true };
    }
    return null;
  }

  const parsedFrom = useMemo(() => (dateFrom ? parseDateString(dateFrom) : null), [dateFrom]);
  const parsedTo = useMemo(() => (dateTo ? parseDateString(dateTo) : null), [dateTo]);
  const parsedFromMs = parsedFrom ? parsedFrom.ms : null;
  const parsedToMs = parsedTo ? parsedTo.ms : null;
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
    if (filterGroupNo.length > 0) count += 1;
    if (filterJuror) count += 1;
    if (filterDept) count += 1;
    if (filterStatus.length > 0) count += 1;
    if (filterProjectTitle) count += 1;
    if (filterStudents) count += 1;
    if (dateFrom || dateTo) count += 1;
    if (filterComment) count += 1;
    return count;
  }, [filterSemester, filterGroupNo, filterJuror, filterDept, filterStatus, filterProjectTitle, filterStudents, dateFrom, dateTo, filterComment]);
  const hasAnyFilter = activeFilterCount > 0;
  const isSemesterFilterActive = !!filterSemester || activeFilterCol === "semester";
  const isGroupNoFilterActive = filterGroupNo.length > 0 || activeFilterCol === "groupNo";
  const isJurorFilterActive = !!filterJuror || activeFilterCol === "juror";
  const isDeptFilterActive = !!filterDept || activeFilterCol === "dept";
  const isStatusFilterActive = filterStatus.length > 0 || activeFilterCol === "status";
  const isProjectTitleFilterActive = !!filterProjectTitle || activeFilterCol === "projectTitle";
  const isStudentsFilterActive = !!filterStudents || activeFilterCol === "students";
  const isUpdatedDateFilterActive = (dateFilterCol === "updated" && (dateFrom || dateTo)) || activeFilterCol === "timestamp";
  const isCompletedDateFilterActive = (dateFilterCol === "completed" && (dateFrom || dateTo)) || activeFilterCol === "finalSubmittedAt";
  const isCommentFilterActive = !!filterComment || activeFilterCol === "comments";

  function resetFilters() {
    setFilterSemester("");
    setFilterGroupNo([]);
    setFilterJuror("");
    setFilterDept("");
    setFilterStatus([]);
    setFilterProjectTitle("");
    setFilterStudents("");
    setDateFrom("");
    setDateTo("");
    setDateError(null);
    setDateFilterCol("updated");
    setFilterComment("");
    setSortKey("updatedMs");
    setSortDir("desc");
    setActiveFilterCol(null);
    setAnchorRect(null);
  }

  function closePopover() {
    setActiveFilterCol(null);
    setAnchorRect(null);
    setAnchorEl(null);
  }

  const toggleMulti = (value, selected, setter, order = []) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    let list = Array.from(next);
    if (order.length > 0) {
      const orderMap = new Map(order.map((v, i) => [v, i]));
      list.sort((a, b) => (orderMap.get(a) ?? 9999) - (orderMap.get(b) ?? 9999));
    }
    setter(list);
  };

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
      ? toMsBase + (parsedTo?.isDateOnly ? (24 * 60 * 60 * 1000 - 1) : 0)
      : toMsBase;

    const assignedList = Array.isArray(assignedJurors) && assignedJurors.length
      ? assignedJurors
      : (Array.isArray(jurors) ? jurors : []);
    const groupList = Array.isArray(groups) ? groups : [];
    const existingKeys = new Set();
    data.forEach((row) => {
      if (!row?.projectId) return;
      const key = rowKey(row);
      if (!key) return;
      existingKeys.add(`${key}__${row.projectId}`);
    });

    const generated = [];
    if (assignedList.length > 0 && groupList.length > 0) {
      assignedList.forEach((j) => {
        const jurorId = j.jurorId ?? j.key;
        const juryName = String(j.name ?? j.juryName ?? "").trim();
        const juryDept = String(j.dept ?? j.juryDept ?? "").trim();
        if (!jurorId && !juryName) return;
        const jurorKey = rowKey({ jurorId, juryName, juryDept });
        groupList.forEach((g) => {
          const projectId = g.id ?? g.projectId;
          if (!projectId) return;
          const key = `${jurorKey}__${projectId}`;
          if (existingKeys.has(key)) return;
          const meta = projectMetaById.get(projectId);
          generated.push({
            jurorId,
            juryName,
            juryDept,
            projectId,
            groupNo: g.groupNo ?? g.group_no ?? null,
            projectName: String(meta?.title ?? g.title ?? "").trim(),
            students: meta?.students ?? g.students ?? "",
            technical: null,
            design: null,
            delivery: null,
            teamwork: null,
            total: null,
            comments: "",
            updatedAt: "",
            updatedMs: null,
            finalSubmittedAt: "",
            finalSubmittedMs: null,
            timestamp: "",
            tsMs: null,
            status: "not_started",
            editingFlag: "",
          });
        });
      });
    }

    let list = [...data, ...generated].map((row) => {
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
    if (filterGroupNo.length > 0) {
      const set = new Set(filterGroupNo.map((v) => String(v).trim().toLowerCase()));
      list = list.filter((r) => set.has(String(r.groupNo ?? "").trim().toLowerCase()));
    }
    if (filterJuror) {
      const q = filterJuror.toLowerCase();
      list = list.filter((r) => `${r.juryName ?? ""} ${r.juryDept ?? ""}`.toLowerCase().includes(q));
    }
    if (filterDept) {
      const q = filterDept.toLowerCase();
      list = list.filter((r) => String(r.juryDept ?? "").toLowerCase().includes(q));
    }
    if (filterStatus.length > 0) {
      const set = new Set(filterStatus);
      list = list.filter((r) => set.has(r.effectiveStatus));
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
        const ms = dateFilterCol === "completed"
          ? (r.finalSubmittedMs || tsToMillis(r.finalSubmittedAt))
          : (r.updatedMs || tsToMillis(r.updatedAt));
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
      dateFrom, dateTo, dateFilterCol, filterComment, sortKey, sortDir, jurorEditMap, assignedJurors, jurors, groups]);

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
        className: "col-filter-popover col-filter-popover-portal col-filter-popover-multi",
        contentKey: filterGroupNo.join("|"),
        content: (
          <>
            <label className="status-option">
              <input
                type="checkbox"
                checked={filterGroupNo.length === 0}
                onChange={() => setFilterGroupNo([])}
              />
              <span>All groups</span>
            </label>
            {groupNoOptions.map((label) => (
              <label key={label} className="status-option">
                <input
                  type="checkbox"
                  checked={filterGroupNo.includes(label)}
                  onChange={() => toggleMulti(label, filterGroupNo, setFilterGroupNo, groupNoOptions)}
                />
                <span>{label}</span>
              </label>
            ))}
            {filterGroupNo.length > 0 && (
              <button className="col-filter-clear" onClick={() => { setFilterGroupNo([]); closePopover(); }}>
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
            <input
              autoFocus
              placeholder="Search juror…"
              value={filterJuror}
              onChange={(e) => setFilterJuror(e.target.value)}
              className={isJurorFilterActive ? "filter-input-active" : ""}
            />
            {filterJuror && (
              <button className="col-filter-clear" onClick={() => { setFilterJuror(""); closePopover(); }}>
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
            <input
              autoFocus
              placeholder="Search department…"
              value={filterDept}
              onChange={(e) => setFilterDept(e.target.value)}
              className={isDeptFilterActive ? "filter-input-active" : ""}
            />
            {filterDept && (
              <button className="col-filter-clear" onClick={() => { setFilterDept(""); closePopover(); }}>
                Clear
              </button>
            )}
          </>
        ),
      };
    }
    if (activeFilterCol === "status") {
      return {
        className: "col-filter-popover col-filter-popover-portal col-filter-popover-multi",
        contentKey: filterStatus.join("|"),
        content: (
          <>
            <label className="status-option">
              <input
                type="checkbox"
                checked={filterStatus.length === 0}
                onChange={() => setFilterStatus([])}
              />
              <span>All statuses</span>
            </label>
            {STATUS_OPTIONS.map((opt) => (
              <label key={opt.value} className="status-option">
                <input
                  type="checkbox"
                  checked={filterStatus.includes(opt.value)}
                  onChange={() => toggleMulti(opt.value, filterStatus, setFilterStatus, STATUS_OPTIONS.map((o) => o.value))}
                />
                <span>{opt.label}</span>
              </label>
            ))}
            {filterStatus.length > 0 && (
              <button className="col-filter-clear" onClick={() => { setFilterStatus([]); closePopover(); }}>
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
    if (activeFilterCol === "timestamp" || activeFilterCol === "finalSubmittedAt") {
      const isDateFilterActive =
        activeFilterCol === "finalSubmittedAt" ? isCompletedDateFilterActive : isUpdatedDateFilterActive;
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
                  type="datetime-local"
                  step="60"
                  placeholder="YYYY-MM-DDThh:mm"
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
                  type="datetime-local"
                  step="60"
                  placeholder="YYYY-MM-DDThh:mm"
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
          <span className="export-label-long">Excel</span>
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
      <div className="detail-table-scroll-top" ref={topScrollRef} aria-hidden="true">
        <div className="detail-table-scroll-top-inner" />
      </div>
      <div className="detail-table-wrap" ref={tableScrollRef}>
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
                  <span
                    className={`col-sort-label details-col-label${isStatusFilterActive ? " filtered" : ""}`}
                    onClick={() => setSort("effectiveStatus")}
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

              {/* Score columns — sort only, no filter */}
              {SCORE_COLS.map(({ key: col, label }) => (
                <th key={col} style={{ cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => setSort(col)}>
                  <span className={`col-sort-label details-col-label${sortKey === col ? " filtered" : ""}`}>
                    {label} <span className={`sort-icon${sortKey === col ? " icon-active-box" : ""}`}>{sortIcon(col)}</span>
                  </span>
                </th>
              ))}

              {/* Updated At */}
              <th style={{ position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span
                    className={`col-sort-label details-col-label${isUpdatedDateFilterActive ? " filtered" : ""}`}
                    onClick={() => setSort("updatedMs")}
                  >
                    Updated At
                  </span>
                  <button
                    type="button"
                    className={`col-filter-hotspot${isUpdatedDateFilterActive ? " active filter-icon-active" : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDateFilterCol("updated");
                      toggleFilterCol("timestamp", e);
                    }}
                    title="Filter by date"
                  >
                    <FilterIcon />
                  </button>
                </div>
              </th>

              {/* Completed At */}
              <th style={{ cursor: "pointer", whiteSpace: "nowrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                  <span
                    className={`col-sort-label details-col-label${isCompletedDateFilterActive ? " filtered" : ""}`}
                    onClick={() => setSort("finalSubmittedMs")}
                  >
                    Completed At
                  </span>
                  <button
                    type="button"
                    className={`col-filter-hotspot${isCompletedDateFilterActive ? " active filter-icon-active" : ""}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDateFilterCol("completed");
                      toggleFilterCol("finalSubmittedAt", e);
                    }}
                    title="Filter by completed date"
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
                <td colSpan={15} style={{ textAlign: "center", padding: 32, color: "#64748b" }}>
                  No matching rows.
                </td>
              </tr>
            )}
            {rows.map((row, i) => {
              const isEditing = row.isEditing;
              const isIP = row.status === "in_progress" || isEditing;
              const projectTitle = row.projectTitle || "";
              const students = row.students || "";
              const statusForBadge =
                row.effectiveStatus === "submitted"
                  ? "submitted"
                  : (row.effectiveStatus === "not_started" ? "not_started" : "in_progress");
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
                      status={statusForBadge}
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
                    {formatTs(row.updatedAt)}
                  </td>
                  <td style={{ fontSize: 12, color: "#475569", whiteSpace: "nowrap" }}>
                    {formatTs(row.finalSubmittedAt)}
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
