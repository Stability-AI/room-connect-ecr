import React, { useState } from "react";

export default function ObjectDetectionPanel({
  hasScene,
  sceneFilename,
  onDetect,
  onToggleOOBBs,
  onClear,
  onCull,
  onMerge,
  onExport,
  detectedObjects,
  showOOBBs,
}) {
  const [filterTerms, setFilterTerms] = useState("");
  const [exclusive, setExclusive] = useState(false);
  const [showCullDialog, setShowCullDialog] = useState(false);
  const [cullThreshold, setCullThreshold] = useState(0.5);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeThreshold, setMergeThreshold] = useState(0.5);

  const handleDetect = () => {
    if (!filterTerms.trim()) return;
    onDetect(filterTerms, exclusive);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") {
      handleDetect();
    }
  };

  const handleCullConfirm = () => {
    onCull(cullThreshold);
    setShowCullDialog(false);
  };

  const handleMergeConfirm = () => {
    onMerge(mergeThreshold);
    setShowMergeDialog(false);
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
            <button
              className="btn btn-toggle"
              onClick={() => setShowCullDialog(true)}
              disabled={detectedObjects.length <= 1}
            >
              Cull Selection
            </button>
            <button
              className="btn btn-toggle"
              onClick={() => setShowMergeDialog(true)}
              disabled={detectedObjects.length <= 1}
            >
              Merge Selection
            </button>
            <button
              className="btn btn-secondary"
              onClick={onClear}
              disabled={detectedObjects.length === 0}
            >
              Clear OOBBs
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

      {showCullDialog && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h2>Cull Sensitivity</h2>
            <div className="dialog-field">
              <label>
                Threshold: <strong>{cullThreshold.toFixed(2)}</strong>
              </label>
              <input
                type="range"
                className="cull-slider"
                min="0"
                max="1"
                step="0.01"
                value={cullThreshold}
                onChange={(e) => setCullThreshold(parseFloat(e.target.value))}
              />
              <div className="slider-labels">
                <span>0.0 (aggressive)</span>
                <span>1.0 (conservative)</span>
              </div>
              <p className="panel-hint">
                Lower values will cull more aggressively (remove OOBBs that are even partially overlapping).
                Higher values require nearly complete containment before removing.
              </p>
            </div>
            <div className="dialog-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowCullDialog(false)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleCullConfirm}>
                Apply Cull
              </button>
            </div>
          </div>
        </div>
      )}

      {showMergeDialog && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h2>Merge Sensitivity</h2>
            <div className="dialog-field">
              <label>
                Threshold: <strong>{mergeThreshold.toFixed(2)}</strong>
              </label>
              <input
                type="range"
                className="cull-slider"
                min="0"
                max="1"
                step="0.01"
                value={mergeThreshold}
                onChange={(e) => setMergeThreshold(parseFloat(e.target.value))}
              />
              <div className="slider-labels">
                <span>0.0 (aggressive)</span>
                <span>1.0 (conservative)</span>
              </div>
              <p className="panel-hint">
                Lower values merge more aggressively (absorb partially overlapping OOBBs).
                Higher values require nearly complete containment before merging.
              </p>
            </div>
            <div className="dialog-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowMergeDialog(false)}
              >
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleMergeConfirm}>
                Apply Merge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
