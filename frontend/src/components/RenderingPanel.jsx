import React, { useState } from "react";

export default function RenderingPanel({ hasScene, sceneFilename }) {
  const [cameraCount, setCameraCount] = useState(10);
  const [renderWidth, setRenderWidth] = useState(1920);
  const [renderHeight, setRenderHeight] = useState(1080);

  const handleAutoPlace = () => {
    console.log("[Rendering] Will auto-generate", cameraCount, "camera positions using safe sampling algorithm");
    console.log("[Rendering] Algorithm: floor detection -> random XZ sampling -> proximity validation -> minimum spacing");
  };

  const handleManualPlace = () => {
    console.log("[Rendering] Will enter manual camera placement mode — click in 3D view to place cameras");
  };

  const handleRender = () => {
    console.log("[Rendering] Will render views at", renderWidth, "x", renderHeight, "for scene:", sceneFilename);
    console.log("[Rendering] Backend option: POST /api/render with camera poses + scene data");
    console.log("[Rendering] Frontend option: Three.js WebGLRenderer.toDataURL() or path-tracing renderer");
  };

  const handleExportRenders = () => {
    console.log("[Rendering] Will export rendered images as ZIP archive");
  };

  return (
    <div className="side-panel">
      <h3>Rendering</h3>

      {!hasScene ? (
        <p className="empty-state">Load a scene to configure rendering.</p>
      ) : (
        <>
          <div className="panel-section">
            <label className="panel-label">Camera Placement</label>
            <div className="panel-row">
              <label className="panel-sublabel">Auto-place count</label>
              <input
                type="number"
                className="panel-input panel-input-small"
                min={1}
                max={100}
                value={cameraCount}
                onChange={(e) => setCameraCount(parseInt(e.target.value) || 1)}
              />
            </div>
            <div className="panel-actions">
              <button className="btn btn-accent" onClick={handleAutoPlace}>
                Auto-Place Cameras
              </button>
              <button className="btn btn-toggle" onClick={handleManualPlace}>
                Manual Place
              </button>
            </div>
          </div>

          <div className="panel-section">
            <label className="panel-label">Render Settings</label>
            <div className="panel-row">
              <label className="panel-sublabel">Width</label>
              <input
                type="number"
                className="panel-input panel-input-small"
                value={renderWidth}
                onChange={(e) => setRenderWidth(parseInt(e.target.value) || 1920)}
              />
            </div>
            <div className="panel-row">
              <label className="panel-sublabel">Height</label>
              <input
                type="number"
                className="panel-input panel-input-small"
                value={renderHeight}
                onChange={(e) => setRenderHeight(parseInt(e.target.value) || 1080)}
              />
            </div>
          </div>

          <div className="panel-section">
            <label className="panel-label">Cameras</label>
            <p className="empty-state">No cameras placed. Use Auto-Place or Manual Place above.</p>
          </div>

          <div className="panel-actions">
            <button className="btn btn-primary" onClick={handleRender}>
              Render Views
            </button>
            <button className="btn btn-export" onClick={handleExportRenders}>
              Export Renders
            </button>
          </div>
        </>
      )}
    </div>
  );
}
