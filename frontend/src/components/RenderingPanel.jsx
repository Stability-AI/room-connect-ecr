import React, { useState } from "react";

export default function RenderingPanel({ hasScene, sceneFilename, sceneFileId, onRenderComplete }) {
  const [cameraCount, setCameraCount] = useState(10);
  const [renderWidth, setRenderWidth] = useState(1920);
  const [renderHeight, setRenderHeight] = useState(1080);
  const [samples, setSamples] = useState(128);
  const [generateDepthmap, setGenerateDepthmap] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderStatus, setRenderStatus] = useState("");
  const [renderResults, setRenderResults] = useState(null);

  const handleAutoPlace = () => {
    console.log("[Rendering] Will auto-generate", cameraCount, "camera positions using safe sampling algorithm");
  };

  const handleManualPlace = () => {
    console.log("[Rendering] Will enter manual camera placement mode");
  };

  const handleRender = async () => {
    if (!sceneFileId) {
      setRenderStatus("Scene not uploaded to backend yet. Please wait for upload to complete.");
      return;
    }

    setIsRendering(true);
    setRenderStatus("Rendering...");
    setRenderResults(null);

    try {
      const response = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneId: sceneFileId,
          width: renderWidth,
          height: renderHeight,
          samples: samples,
          generateDepthmap: generateDepthmap,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setRenderStatus(`Render failed: ${data.error || "Unknown error"}`);
        return;
      }

      setRenderResults(data.outputs);
      setRenderStatus("Render complete!");
      if (onRenderComplete) onRenderComplete(data.outputs);
    } catch (err) {
      setRenderStatus(`Render failed: ${err.message}`);
    } finally {
      setIsRendering(false);
    }
  };

  const handleDownload = (url, filename) => {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
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
            <div className="panel-row">
              <label className="panel-sublabel">Samples</label>
              <input
                type="number"
                className="panel-input panel-input-small"
                min={1}
                max={8192}
                value={samples}
                onChange={(e) => setSamples(parseInt(e.target.value) || 128)}
              />
            </div>
          </div>

          <div className="panel-section">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={generateDepthmap}
                onChange={(e) => setGenerateDepthmap(e.target.checked)}
              />
              <span>Generate depthmaps</span>
            </label>
          </div>

          <div className="panel-actions">
            <button
              className="btn btn-primary"
              onClick={handleRender}
              disabled={isRendering || !sceneFileId}
            >
              {isRendering ? "Rendering..." : "Render Views"}
            </button>
          </div>

          {renderStatus && (
            <div className="panel-section">
              <p className={`render-status ${renderResults ? "success" : ""}`}>
                {renderStatus}
              </p>
            </div>
          )}

          {renderResults && (
            <div className="panel-section">
              <label className="panel-label">Output</label>
              <div className="panel-actions">
                {renderResults.color && (
                  <button
                    className="btn btn-export"
                    onClick={() => handleDownload(renderResults.color, "render.png")}
                  >
                    Download Render (PNG)
                  </button>
                )}
                {renderResults.depth && (
                  <button
                    className="btn btn-export"
                    onClick={() => handleDownload(renderResults.depth, "depth.exr")}
                  >
                    Download Depth (EXR)
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
