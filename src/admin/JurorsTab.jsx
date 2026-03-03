// src/admin/JurorsTab.jsx

import { useState, useMemo, useEffect } from "react";
import { formatTs, adminCompletionPct, cmp } from "./utils";
import { readSection, writeSection } from "./persist";
import { StatusBadge } from "./components";
import { CircleCheckBigIcon, ClockIcon, UserCheckIcon, ChevronDownIcon, FolderKanbanIcon, PencilIcon } from "../shared/Icons";

// jurorStats prop: { key, name, dept, jurorId, rows, overall, latestRow }[]
// groups prop: { id (uuid), groupNo, label }[]
export default function JurorsTab({ jurorStats, groups = [] }) {
  const [selectedJurorId, setSelectedJurorId] = useState(() => {
    const s = readSection("jurors");
    return typeof s.selectedJurorId === "string" ? s.selectedJurorId : "";
  });

  useEffect(() => {
    writeSection("jurors", { selectedJurorId });
  }, [selectedJurorId]);

  const [expandedGroups, setExpandedGroups] = useState(new Set());

  function toggleGroup(groupKey) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      next.has(groupKey) ? next.delete(groupKey) : next.add(groupKey);
      return next;
    });
  }

  const jurorOptions = useMemo(() => {
    return jurorStats
      .slice()
      .sort((a, b) => cmp(a.jury, b.jury))
      .map((s) => ({
        id: s.jurorId || s.latestRow?.jurorId || "",
        label: `${s.jury}${s.latestRow?.juryDept ? ` (${s.latestRow.juryDept})` : ""}`,
      }))
      .filter((opt, idx, arr) => opt.id && arr.findIndex((o) => o.id === opt.id) === idx);
  }, [jurorStats]);

  const filtered = useMemo(() => {
    let list = jurorStats.slice().sort((a, b) => cmp(a.jury, b.jury));
    if (selectedJurorId) {
      list = list.filter((s) => (s.jurorId || s.latestRow?.jurorId || "") === selectedJurorId);
    }
    return list;
  }, [jurorStats, selectedJurorId]);

  return (
    <div className="jurors-tab-wrap">
      {/* Search bar */}
      <div className="juror-filter-bar">
        <select
          className="juror-filter-select"
          value={selectedJurorId}
          onChange={(e) => setSelectedJurorId(e.target.value)}
          aria-label="Filter by juror"
        >
          <option value="">All jurors</option>
          {jurorOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 && (
        <div className="empty-msg">No jurors match the current filter.</div>
      )}

      <div className="jurors-grid jurors-grid-full">
        {filtered.map((stat) => {
          const { key, jury, rows, overall, latestRow } = stat;

          // Progress bar using groups prop for total count
          const pct = adminCompletionPct(rows, groups.length);

          const barColor =
            pct === 100 ? "#22c55e" :
            pct > 66    ? "#84cc16" :
            pct > 33    ? "#eab308" :
            pct > 0     ? "#f97316" : "#e2e8f0";

          // Completion check: are all projects submitted?
          const grpStatuses = groups.map((g) => {
            const row = rows.find((r) => r.projectId === g.id);
            const normalizedStatus =
              row?.status === "submitted" ? "submitted" : (row?.status || "not_started");
            return { id: g.id, status: normalizedStatus };
          });
          const isCompleted =
            grpStatuses.length > 0 && grpStatuses.every((g) => g.status === "submitted");

          const statusClass =
            overall === "all_submitted" ? "juror-card-all-submitted" :
            overall === "in_progress"   ? "juror-card-in-progress"   : "";

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
                  <div className="juror-header-actions">
                    {isCompleted ? (
                      <StatusBadge variant="completed" icon={<CircleCheckBigIcon />}>
                        Completed
                      </StatusBadge>
                    ) : (
                      <StatusBadge status={overall} />
                    )}
                  </div>
                </div>

                <div className="juror-meta">
                  {latestRow?.timestamp && (
                    <div className="juror-last-submit">
                      <span className="juror-last-submit-label">Last activity</span>
                      <span className="juror-last-submit-time">
                        {formatTs(latestRow?.timestamp)}
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
                {rows
                  .slice()
                  .sort((a, b) => (a.groupNo ?? 0) - (b.groupNo ?? 0))
                  .map((d) => {
                    const grp = groups.find((g) => g.id === d.projectId);
                    const groupKey = `${key}-${d.projectId}`;
                    const panelId = `juror-group-panel-${groupKey}`;
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
                                <span className="juror-row-name-icon" aria-hidden="true"><FolderKanbanIcon /></span>
                                <span className="juror-row-name-text">
                                  {grp?.label || `Group ${d.groupNo ?? d.projectId}`}
                                </span>
                              </span>
                            </div>
                          </div>
                          {/* RIGHT: KPI stack */}
                          <div className="juror-row-right">
                            {d.timestamp && (
                              <span className="juror-row-ts">
                                <span className="juror-row-ts-icon" aria-hidden="true"><ClockIcon /></span>
                                {formatTs(d.timestamp)}
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
