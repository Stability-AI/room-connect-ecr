import React, { useState } from "react";

export default function ObjectDetectionPanel({ hasScene, sceneFilename }) {
  const [filterTerms, setFilterTerms] = useState("");

  const handleFilter = () => {
    console.log("[ObjectDetection] Will filter scene objects by terms:", filterTerms);
    console.log("[ObjectDetection] This will traverse the GLTF scene graph and compute OOBBs for matching meshes");
  };

  const handleToggleOOBBs = () => {
    console.log("[ObjectDetection] Will toggle OOBB overlays in the 3D view");
  };

  const handleExportObjects = () => {
    console.log("[ObjectDetection] Will export detected objects with OOBB data as JSON for scene:", sceneFilename);
  };

  return (
    <div className="side-panel">
      <h3>Object Detection</h3>

      {!hasScene ? (
        <p className="empty-state">Load a scene to detect and filter objects.</p>
      ) : (
        <>
          <div className="panel-section">
            <label className="panel-label">Filter Objects (comma-separated)</label>
            <input
              type="text"
              className="panel-input"
              placeholder="e.g. _furniture_, _chair_"
              value={filterTerms}
              onChange={(e) => setFilterTerms(e.target.value)}
            />
            <p className="panel-hint">
              Objects matching these substrings will be selected for OOBB computation.
            </p>
          </div>

          <div className="panel-actions">
            <button className="btn btn-accent" onClick={handleFilter} disabled={!filterTerms.trim()}>
              Detect Objects
            </button>
            <button className="btn btn-toggle" onClick={handleToggleOOBBs}>
              Show OOBBs
            </button>
            <button className="btn btn-export" onClick={handleExportObjects}>
              Export Objects (JSON)
            </button>
          </div>

          <div className="panel-section">
            <label className="panel-label">Detected Objects</label>
            <p className="empty-state">No objects detected yet. Enter filter terms and click Detect Objects.</p>
          </div>
        </>
      )}
    </div>
  );
}
