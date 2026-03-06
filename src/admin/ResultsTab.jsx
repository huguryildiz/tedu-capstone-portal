// src/admin/ResultsTab.jsx
// Merges Summary, Details, and Matrix views into one tab with a view switcher.
// Selected view is persisted via persist.js "results" section.

import { useState } from "react";
import { readSection, writeSection } from "./persist";
import { Grid3x3Icon, MedalIcon, TableIcon } from "../shared/Icons";
import SummaryTab from "./SummaryTab";
import DetailsTab from "./DetailsTab";
import MatrixTab  from "./MatrixTab";

const VIEWS = [
  { id: "rankings", label: "Rankings", icon: MedalIcon },
  { id: "table",    label: "Table",    icon: TableIcon },
  { id: "matrix",   label: "Matrix",   icon: Grid3x3Icon },
];

export default function ResultsTab({
  ranked,
  submittedData,
  rawScores,
  jurors,
  matrixJurors,
  jurorColorMap,
  groups,
  semesterName,
  summaryData,
  jurorDeptMap,
}) {
  const [view, setView] = useState(
    () => readSection("results").view || "rankings"
  );

  function switchView(id) {
    setView(id);
    writeSection("results", { view: id });
  }

  return (
    <div className="results-tab">
      <div className="results-view-switcher">
        {VIEWS.map((v) => {
          const Icon = v.icon;
          return (
            <button
              key={v.id}
              className={`results-view-btn${view === v.id ? " active" : ""}`}
              onClick={() => switchView(v.id)}
            >
              <span className="results-view-icon" aria-hidden="true"><Icon /></span>
              <span className="results-view-label">{v.label}</span>
            </button>
          );
        })}
      </div>

      {view === "rankings" && (
        <SummaryTab ranked={ranked} submittedData={submittedData} />
      )}
      {view === "table" && (
        <DetailsTab
          data={rawScores}
          jurors={jurors}
          assignedJurors={matrixJurors || jurors}
          jurorColorMap={jurorColorMap}
          groups={groups}
          semesterName={semesterName}
          summaryData={summaryData}
        />
      )}
      {view === "matrix" && (
        <MatrixTab
          data={rawScores}
          jurors={matrixJurors || jurors}
          groups={groups}
          jurorDeptMap={jurorDeptMap}
        />
      )}
    </div>
  );
}
