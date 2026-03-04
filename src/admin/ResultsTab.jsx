// src/admin/ResultsTab.jsx
// Merges Summary, Details, and Matrix views into one tab with a view switcher.
// Selected view is persisted via persist.js "results" section.

import { useState } from "react";
import { readSection, writeSection } from "./persist";
import SummaryTab from "./SummaryTab";
import DetailsTab from "./DetailsTab";
import MatrixTab  from "./MatrixTab";

const VIEWS = [
  { id: "rankings", label: "Rankings" },
  { id: "table",    label: "Table"    },
  { id: "matrix",   label: "Matrix"   },
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
        {VIEWS.map((v) => (
          <button
            key={v.id}
            className={`results-view-btn${view === v.id ? " active" : ""}`}
            onClick={() => switchView(v.id)}
          >
            {v.label}
          </button>
        ))}
      </div>

      {view === "rankings" && (
        <SummaryTab ranked={ranked} submittedData={submittedData} />
      )}
      {view === "table" && (
        <DetailsTab
          data={rawScores}
          jurors={jurors}
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
