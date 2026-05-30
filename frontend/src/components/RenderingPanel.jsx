import React, { useState } from "react";

export default function RenderingPanel({
  hasScene,
  sceneFilename,
  sceneFileId,
  onBrightnessChange,
  cameras,
  selectedCameraId,
  onPlaceCamera,
  onAutoPlaceCameras,
  onSelectCamera,
  onRealignCamera,
  onDeleteCamera,
  onClearAllCameras,
  exportCameraData,
  hasDetectedObjects,
}) {
  const [cameraCount, setCameraCount] = useState(10);
  const [maximizeEntropy, setMaximizeEntropy] = useState(false);
  const [renderWidth, setRenderWidth] = useState(1920);
  const [renderHeight, setRenderHeight] = useState(1080);
  const [samples, setSamples] = useState(128);
  const [generateDepthmap, setGenerateDepthmap] = useState(false);
  const [overrideLighting, setOverrideLighting] = useState(false);
  const [lightingBrightness, setLightingBrightness] = useState(1.5);
  const [includeBlend, setIncludeBlend] = useState(false);
  const [exportIntrinsics, setExportIntrinsics] = useState(false);
  const [showDebugConsole, setShowDebugConsole] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderStatus, setRenderStatus] = useState("");
  const [renderLogs, setRenderLogs] = useState([]);
  const [renderResults, setRenderResults] = useState(null);

  const handleAutoPlace = () => {
    if (onAutoPlaceCameras) {
      onAutoPlaceCameras(cameraCount, maximizeEntropy);
    }
  };

  const handleRender = async () => {
    if (!sceneFileId) {
      setRenderStatus("Scene not uploaded to backend yet.");
      return;
    }
    if (cameras.length === 0) {
      setRenderStatus("No cameras placed. Use Place at View to add cameras.");
      return;
    }

    setIsRendering(true);
    setRenderStatus(`Rendering ${cameras.length} view(s)...`);
    setRenderResults(null);
    setRenderLogs([]);

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
          overrideLighting: overrideLighting,
          lightingBrightness: lightingBrightness,
          includeBlend: includeBlend,
          cameras: cameras.map((c) => ({
            id: c.id,
            name: c.name,
            position: c.position,
            quaternion: c.quaternion,
            fov: c.fov,
          })),
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        let eventType = null;
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            eventType = line.slice(7).trim();
          } else if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (eventType === "log") {
              setRenderLogs((prev) => [...prev, data]);
            } else if (eventType === "result") {
              const result = JSON.parse(data);
              setRenderResults(result);
              setRenderStatus("Render complete!");
            } else if (eventType === "error") {
              const err = JSON.parse(data);
              setRenderStatus(`Render failed: ${err.error}`);
            }
            eventType = null;
          }
        }
      }
    } catch (err) {
      setRenderStatus(`Render failed: ${err.message}`);
    } finally {
      setIsRendering(false);
    }
  };

  const handleDownloadZip = () => {
    if (renderResults && renderResults.zip) {
      const a = document.createElement("a");
      a.href = renderResults.zip;
      a.download = "renders.zip";
      a.click();
    }
  };

  const handleExportCameraData = () => {
    if (exportCameraData) {
      const data = exportCameraData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "camera_data.json";
      a.click();
      URL.revokeObjectURL(url);
    }
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
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={maximizeEntropy}
                onChange={(e) => setMaximizeEntropy(e.target.checked)}
                disabled={!hasDetectedObjects}
              />
              <span>Maximize Viewpoint Entropy</span>
            </label>
            {maximizeEntropy && !hasDetectedObjects && (
              <p className="panel-hint" style={{ color: "var(--accent-orange)" }}>
                Detect objects first (Object Detection tab) to enable entropy-based orientation.
              </p>
            )}
            <div className="panel-actions">
              <button className="btn btn-accent" onClick={handleAutoPlace} disabled={!hasScene}>
                Auto-Place Cameras
              </button>
              <button className="btn btn-primary" onClick={onPlaceCamera}>
                Place at View
              </button>
            </div>
          </div>

          {/* Camera list */}
          <div className="panel-section">
            <label className="panel-label">Cameras ({cameras.length})</label>
            {cameras.length === 0 ? (
              <p className="empty-state">No cameras placed. Navigate to desired view and click Place at View.</p>
            ) : (
              <>
                <ul className="object-list">
                  {cameras.map((cam) => (
                    <li
                      key={cam.id}
                      className={`object-item ${cam.id === selectedCameraId ? "selected" : ""}`}
                      onClick={() => onSelectCamera(cam.id)}
                      onDoubleClick={() => onSelectCamera(cam.id, true)}
                    >
                      <span className="object-name">{cam.name}</span>
                      <button
                        className="btn-delete"
                        onClick={(e) => { e.stopPropagation(); onDeleteCamera(cam.id); }}
                        title="Delete camera"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
                {selectedCameraId && (
                  <div className="panel-actions" style={{ marginTop: 8 }}>
                    <button className="btn btn-toggle" onClick={() => onSelectCamera(selectedCameraId, true)}>
                      Align Viewpoint
                    </button>
                    <button className="btn btn-toggle" onClick={onRealignCamera}>
                      Realign to View
                    </button>
                  </div>
                )}
                <div className="panel-actions" style={{ marginTop: 8 }}>
                  <button className="btn btn-toggle" onClick={onClearAllCameras}>
                    Clear All
                  </button>
                </div>
              </>
            )}
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
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={overrideLighting}
                onChange={(e) => setOverrideLighting(e.target.checked)}
              />
              <span>Override lighting</span>
            </label>
            {overrideLighting && (
              <div className="panel-row" style={{ marginTop: 8 }}>
                <label className="panel-sublabel">Brightness</label>
                <input
                  type="range"
                  className="cull-slider"
                  min="0.5"
                  max="4.0"
                  step="0.1"
                  value={lightingBrightness}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setLightingBrightness(val);
                    if (onBrightnessChange) onBrightnessChange(val);
                  }}
                />
                <span style={{ fontSize: "0.75rem", color: "var(--text-secondary)", minWidth: 30 }}>
                  {lightingBrightness.toFixed(1)}x
                </span>
              </div>
            )}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={exportIntrinsics}
                onChange={(e) => setExportIntrinsics(e.target.checked)}
              />
              <span>Export camera intrinsics/extrinsics</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={includeBlend}
                onChange={(e) => setIncludeBlend(e.target.checked)}
              />
              <span>Include .blend file in download</span>
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={showDebugConsole}
                onChange={(e) => setShowDebugConsole(e.target.checked)}
              />
              <span>Show debug console</span>
            </label>
          </div>

          <div className="panel-actions">
            <button
              className="btn btn-primary"
              onClick={handleRender}
              disabled={isRendering || !sceneFileId || cameras.length === 0}
            >
              {isRendering ? "Rendering..." : `Render Views (${cameras.length})`}
            </button>
            {exportIntrinsics && cameras.length > 0 && (
              <button className="btn btn-export" onClick={handleExportCameraData}>
                Export Camera Data (JSON)
              </button>
            )}
          </div>

          {isRendering && (
            <div className="panel-section">
              <div className="barber-pole-container">
                <div className="barber-pole" />
              </div>
              <p className="render-status">{renderStatus}</p>
            </div>
          )}

          {!isRendering && renderStatus && (
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
                <button className="btn btn-export" onClick={handleDownloadZip}>
                  Download All (ZIP)
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showDebugConsole && (
        <div className="debug-console">
          <div className="debug-console-header">
            <span>Blender Render Log</span>
          </div>
          <div className="debug-console-body">
            {renderLogs.length === 0 ? (
              <span className="debug-empty">No render logs yet. Click Render Views to start.</span>
            ) : (
              renderLogs.map((line, i) => (
                <div key={i} className="debug-line">{line}</div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
