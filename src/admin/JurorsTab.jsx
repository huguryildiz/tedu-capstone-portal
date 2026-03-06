// src/admin/JurorsTab.jsx

import { useState, useMemo, useEffect } from "react";
import { formatTs, adminCompletionPct, cmp } from "./utils";
import { readSection, writeSection } from "./persist";
import { StatusBadge } from "./components";
import {
  CircleCheckBigIcon,
  ClockIcon,
  UserCheckIcon,
  PencilIcon,
  ChevronDownIcon,
  SearchIcon,
  XIcon,
} from "../shared/Icons";
import { GroupLabel, ProjectTitle, StudentNames } from "../components/EntityMeta";

// jurorStats prop: { key, name, dept, jurorId, rows, overall, latestRow }[]
// groups prop: { id (uuid), groupNo, label }[]
export default function JurorsTab({ jurorStats, groups = [] }) {
  const [searchTerm, setSearchTerm] = useState(() => {
    const s = readSection("jurors");
    return typeof s.searchTerm === "string" ? s.searchTerm : "";
  });

  useEffect(() => {
    writeSection("jurors", { searchTerm });
  }, [searchTerm]);

  const [expandedGroups, setExpandedGroups] = useState(new Set());

  function toggleGroup(groupKey) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey);
      return next;
    });
  }

  const normalizedSearch = searchTerm.trim().toLowerCase();
  const filtered = useMemo(() => {
    let list = jurorStats.slice().sort((a, b) => cmp(a.jury, b.jury));
    if (normalizedSearch) {
      list = list.filter((s) => {
        const dept = s.latestRow?.juryDept || "";
        const haystack = `${s.jury} ${dept}`.toLowerCase();
        return haystack.includes(normalizedSearch);
      });
    }
    return list;
  }, [jurorStats, normalizedSearch]);

  const groupById = useMemo(
    () => new Map(groups.map((g) => [g.id, g])),
    [groups]
  );

  return (
    <div className="jurors-tab-wrap">
      {/* Search bar */}
      <div className="juror-filter-bar">
        <div className="juror-search-wrap">
          <span className="juror-search-icon" aria-hidden="true"><SearchIcon /></span>
          <input
            className="juror-search-input"
            type="text"
            placeholder="Search jurors"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label="Search jurors"
          />
          {searchTerm && (
            <button
              className="juror-search-clear"
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchTerm("")}
            >
              <XIcon />
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="empty-msg">No jurors match the current filter.</div>
      )}

      <div className="jurors-grid jurors-grid-full">
        {filtered.map((stat) => {
          const { key, jury, rows, latestRow, editEnabled } = stat;
          const isEditing = !!editEnabled;

          // Progress bar using groups prop for total count
          const pct = adminCompletionPct(rows, groups.length);

          const barColor =
            pct === 100 ? "#22c55e" :
            pct > 66    ? "#84cc16" :
            pct > 33    ? "#eab308" :
            pct > 0     ? "#f97316" : "#e2e8f0";

          // Completion check: are all projects submitted?
          const rowMap = new Map(rows.map((r) => [r.projectId, r]));
          const perGroupRows = groups.map((g) => {
            const row = rowMap.get(g.id);
            if (row) return row;
            return {
              projectId: g.id,
              groupNo: g.groupNo,
              projectName: g.title ?? "",
              status: "not_started",
              total: null,
              updatedAt: "",
            };
          });
          const grpStatuses = perGroupRows.map((d) =>
            d.status === "submitted" ? "submitted" : (d.status || "not_started")
          );
          const isCompleted =
            grpStatuses.length > 0 && grpStatuses.every((s) => s === "submitted");
          const hasAnyProgress = rows.some((r) =>
            r.status === "submitted" || r.status === "in_progress"
          );
          const overallStatus = isCompleted
            ? "all_submitted"
            : (hasAnyProgress ? "in_progress" : "not_started");

          const statusClass =
            isEditing                 ? "juror-card-editing"       :
            overallStatus === "all_submitted" ? "juror-card-all-submitted" :
            overallStatus === "in_progress"   ? "juror-card-in-progress"   :
            overallStatus === "not_started"   ? "juror-card-not-started"   : "";

          return (
            <div key={key} className={`juror-card ${statusClass}`}>
              <div className="juror-card-header">
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="juror-name" style={{ wordBreak: "break-word" }}>
                    <span className="juror-name-icon" aria-hidden="true"><UserCheckIcon /></span>
                    <span className="juror-name-text">
                      {jury}
                      {latestRow?.juryDept && (
                        <span className="juror-dept-inline"> ({latestRow.juryDept})</span>
                      )}
                    </span>
                  </div>
                  <div className={`juror-header-actions${isEditing ? " juror-meta-editing" : ""}`}>
                    {isEditing ? (
                      <StatusBadge editingFlag="editing" />
                    ) : isCompleted ? (
                      <StatusBadge variant="completed" icon={<CircleCheckBigIcon />}>
                        Completed
                      </StatusBadge>
                    ) : (
                      <StatusBadge status={overallStatus} />
                    )}
                  </div>
                </div>

                <div className="juror-meta">
                  {latestRow?.updatedAt && (
                    <div className="juror-last-submit">
                      <span className="juror-last-submit-label">Last activity</span>
                      <span className="juror-last-submit-time">
                        {formatTs(latestRow?.updatedAt)}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Progress bar */}
              <div className="juror-progress-wrap">
                <div className="juror-progress-bar-bg">
                  <div
                    className="juror-progress-bar-fill"
                    style={{ width: `${pct}%`, background: barColor }}
                  />
                </div>
                <span className="juror-progress-label">{pct}%</span>
              </div>

              {/* Per-group rows */}
              <div className="juror-projects">
                {perGroupRows.map((d) => {
                    const grp = groupById.get(d.projectId);
                    const groupKey = `${key}-${d.projectId}`;
                    const panelId = `juror-group-panel-${groupKey}`;
                    const isExpanded = expandedGroups.has(groupKey);
                    const projectTitle = String(d.projectName ?? grp?.title ?? "").trim();
                    const studentsRaw = grp?.students ?? "";
                    const studentList = Array.isArray(studentsRaw)
                      ? studentsRaw.map((s) => String(s).trim()).filter(Boolean)
                      : String(studentsRaw)
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean);
                    const studentNames = studentList.length ? studentList : ["—"];
                    return (
                      <div key={groupKey} className="juror-row-wrap">
                        <div
                          className="juror-row group-accordion-header"
                          role="button"
                          tabIndex={-1}
                          aria-controls={panelId}
                          style={{ cursor: "default" }}
                        >
                          {/* LEFT: identity column */}
                          <div className="juror-row-left">
                            <div className="juror-row-header-line">
                              <span className="juror-row-name">
                                <GroupLabel text={grp?.label || `Group ${d.groupNo ?? d.projectId}`} />
                              </span>
                              <button
                                type="button"
                                className={`juror-row-toggle juror-row-toggle-inline${isExpanded ? " is-open" : ""}`}
                                aria-expanded={isExpanded}
                                aria-controls={panelId}
                                onClick={() => toggleGroup(groupKey)}
                                title={isExpanded ? "Hide details" : "Show details"}
                              >
                                <span className={`group-accordion-chevron${isExpanded ? " open" : ""}`}>
                                  <ChevronDownIcon />
                                </span>
                              </button>
                            </div>
                          </div>
                          {/* RIGHT: KPI stack */}
                          <div className="juror-row-right">
                            {d.updatedAt && (
                              <span className="juror-row-ts">
                                <span className="juror-row-ts-icon" aria-hidden="true"><ClockIcon /></span>
                                {formatTs(d.updatedAt)}
                              </span>
                            )}
                            <div className="juror-row-right-meta">
                              <StatusBadge status={d.status} />
                              {d.status === "submitted" && (
                                <span
                                  className="juror-score"
                                  title="/ 100"
                                  aria-label={`${d.total} / 100`}
                                >
                                  {d.total}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div
                          id={panelId}
                          className={`group-accordion-panel${isExpanded ? " open" : ""}`}
                        >
                          <div className="group-accordion-panel-inner juror-accordion-inner">
                            <div className="juror-row-detail-line juror-row-detail-title">
                              <ProjectTitle text={projectTitle || "—"} size={14} />
                            </div>
                            <div className="juror-row-detail-line juror-row-detail-students">
                              <StudentNames names={studentNames} size={14} />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
