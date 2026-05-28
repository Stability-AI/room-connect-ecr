import React, { useState } from "react";

export default function ObjectDetectionPanel({
  hasScene,
  sceneFilename,
  onDetect,
  onToggleOOBBs,
  onExport,
  detectedObjects,
  showOOBBs,
}) {
  const [filterTerms, setFilterTerms] = useState("");
  const [exclusive, setExclusive] = useState(false);

  const handleDetect = () => {
    if (!filterTerms.trim()) return;
    onDetect(filterTerms, exclusive);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleDetect();
    }
  };

  return (
    <div className="side-panel">
      <h3>Object Detection</h3>

      {!hasScene ? (
        <p className="empty-state">Load a scene to detect and filter objects.</p>
      ) : (
        <>
          <div className="panel-section">
            <label className="panel-label">Filter Substrings (comma-separated)</label>
            <input
              type="text"
              className="panel-input"
              placeholder="e.g. furniture, chair, desk"
              value={filterTerms}
              onChange={(e) => setFilterTerms(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <p className="panel-hint">
              Case-insensitive matching against mesh names in the scene.
            </p>
          </div>

          <div className="panel-section">
            <label className="panel-label">Mode</label>
            <div className="mode-toggle">
              <button
                className={`btn btn-mode ${!exclusive ? "active" : ""}`}
                onClick={() => setExclusive(false)}
              >
                Include
              </button>
              <button
                className={`btn btn-mode ${exclusive ? "active" : ""}`}
                onClick={() => setExclusive(true)}
              >
                Exclude
              </button>
            </div>
            <p className="panel-hint">
              {exclusive
                ? "Objects NOT matching the terms will be detected."
                : "Objects matching the terms will be detected."}
            </p>
          </div>

          <div className="panel-actions">
            <button
              className="btn btn-accent"
              onClick={handleDetect}
              disabled={!filterTerms.trim()}
            >
              Detect Objects
            </button>
            <button
              className={`btn btn-toggle ${showOOBBs ? "active" : ""}`}
              onClick={onToggleOOBBs}
              disabled={detectedObjects.length === 0}
            >
              {showOOBBs ? "Hide OOBBs" : "Show OOBBs"}
            </button>
            <button
              className="btn btn-export"
              onClick={onExport}
              disabled={detectedObjects.length === 0}
            >
              Export Objects (JSON)
            </button>
          </div>

          <div className="panel-section">
            <label className="panel-label">
              Detected Objects ({detectedObjects.length})
            </label>
            {detectedObjects.length === 0 ? (
              <p className="empty-state">
                No objects detected yet. Enter filter terms and click Detect Objects.
              </p>
            ) : (
              <ul className="object-list">
                {detectedObjects.map((obj, i) => (
                  <li key={i} className="object-item">
                    <span className="object-name">{obj.name}</span>
                    <span className="object-size">
                      {obj.halfExtents.map((h) => (h * 2).toFixed(1)).join(" x ")}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
