import React, { useState, useEffect } from "react";
import * as THREE from "three";

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
  renderWidth: propRenderWidth,
  renderHeight: propRenderHeight,
  onRenderSizeChange,
  onRenderOverlaysChange,
  onFovChange,
  propFovOverride,
  onLoadCameras,
  onRenderSelected,
  onAddLight,
  sceneLights = [],
  onUpdateLightIntensity,
  onUpdateLightAngle,
  onUpdateLightExposure,
  onDeleteLight,
  sessionVolumes = [],
  sessionDetectedObjects = [],
}) {
  const [cameraCount, setCameraCount] = useState(10);
  const [maximizeEntropy, setMaximizeEntropy] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [eyeHeightRatio, setEyeHeightRatio] = useState(0.3);
  const [minDistanceRatio, setMinDistanceRatio] = useState(0.02);
  const [minSpacingRatio, setMinSpacingRatio] = useState(0.05);
  const [renderWidth, setRenderWidthLocal] = useState(propRenderWidth || 1920);
  const [renderHeight, setRenderHeightLocal] = useState(propRenderHeight || 1080);

  // Sync local state when parent updates (e.g. from loading camera JSON)
  useEffect(() => {
    if (propRenderWidth) setRenderWidthLocal(propRenderWidth);
  }, [propRenderWidth]);
  useEffect(() => {
    if (propRenderHeight) setRenderHeightLocal(propRenderHeight);
  }, [propRenderHeight]);
  useEffect(() => {
    if (propFovOverride && propFovOverride !== customFov) {
      setOverrideFov(true);
      setCustomFov(propFovOverride);
    }
  }, [propFovOverride]);

  const setRenderWidth = (w) => {
    setRenderWidthLocal(w);
    if (onRenderSizeChange) onRenderSizeChange(w, renderHeight);
  };
  const setRenderHeight = (h) => {
    setRenderHeightLocal(h);
    if (onRenderSizeChange) onRenderSizeChange(renderWidth, h);
  };
  const [overrideFov, setOverrideFov] = useState(false);
  const [customFov, setCustomFov] = useState(60);
  const [constrainToVolume, setConstrainToVolume] = useState(false);
  const [volumeGraph, setVolumeGraph] = useState(null);
  const [selectedVolumeId, setSelectedVolumeId] = useState("");
  const [loadedObjects, setLoadedObjects] = useState(null);
  const [samples, setSamples] = useState(128);
  const [generateDepthmap, setGenerateDepthmap] = useState(false);
  const [overrideLighting, setOverrideLighting] = useState(false);
  const [lightingBrightness, setLightingBrightness] = useState(1.5);
  const [includeBlend, setIncludeBlend] = useState(false);
  const [exportIntrinsics, setExportIntrinsics] = useState(false);
  const [showDebugConsole, setShowDebugConsole] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderStatus, setRenderStatus] = useState("");
  const [renderLogs, setRenderLogs] = useState([]);
  const [renderResults, setRenderResults] = useState(null);

  // Notify parent of FOV changes
  useEffect(() => {
    if (onFovChange) {
      onFovChange(overrideFov ? customFov : null);
    }
  }, [overrideFov, customFov, onFovChange]);

  // Use session data as fallback when no file is explicitly loaded
  const effectiveVolumes = volumeGraph ? volumeGraph.volumes : sessionVolumes;
  const effectiveObjects = loadedObjects || sessionDetectedObjects;

  // Notify parent of overlay data for 3D visualization
  useEffect(() => {
    if (onRenderOverlaysChange) {
      onRenderOverlaysChange({
        volumes: constrainToVolume ? effectiveVolumes : [],
        objects: maximizeEntropy ? effectiveObjects : [],
        selectedVolumeId: constrainToVolume ? selectedVolumeId : null,
      });
    }
  }, [effectiveVolumes, effectiveObjects, constrainToVolume, maximizeEntropy, selectedVolumeId, onRenderOverlaysChange]);

  const handleAutoPlace = () => {
    if (!onAutoPlaceCameras) return;
    setIsGenerating(true);

    // Build volume constraint if enabled
    let volumeConstraint = null;
    if (constrainToVolume && selectedVolumeId && effectiveVolumes.length > 0) {
      const vol = effectiveVolumes.find((v) => v.id === selectedVolumeId);
      if (vol) {
        volumeConstraint = {
          center: vol.center || vol.position,
          size: vol.size,
        };
      }
    }

    setTimeout(() => {
      onAutoPlaceCameras(cameraCount, maximizeEntropy && effectiveObjects.length > 0, {
        eyeHeightRatio,
        minDistanceRatio,
        minSpacingRatio,
        volumeConstraint,
        loadedObjects: maximizeEntropy ? effectiveObjects : null,
      });
      setIsGenerating(false);
    }, 50);
  };

  const handleLoadVolumeGraph = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        setVolumeGraph(data);
        if (data.volumes && data.volumes.length > 0) {
          setSelectedVolumeId(data.volumes[0].id);
        }
      } catch (err) {
        console.error("Failed to parse connectivity graph:", err);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleLoadCameras = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.cameras && onLoadCameras) {
          onLoadCameras(data.cameras);
        }
      } catch (err) {
        console.error("Failed to parse camera data:", err);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleLoadObjects = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        const rawObjects = data.objects || [];
        // Normalize: exported format has nested oobb field, internal format is flat
        const normalized = rawObjects.map((obj) => {
          if (obj.oobb) {
            // Convert 3x3 rotation matrix to quaternion
            let quat = [0, 0, 0, 1];
            if (obj.oobb.rotation && obj.oobb.rotation.length === 9) {
              const r = obj.oobb.rotation;
              const m = new THREE.Matrix4();
              m.set(
                r[0], r[1], r[2], 0,
                r[3], r[4], r[5], 0,
                r[6], r[7], r[8], 0,
                0, 0, 0, 1
              );
              const q = new THREE.Quaternion().setFromRotationMatrix(m);
              quat = [q.x, q.y, q.z, q.w];
            }
            return {
              name: obj.name,
              center: obj.oobb.center,
              halfExtents: obj.oobb.halfExtents,
              rotation: obj.oobb.rotation,
              quaternion: quat,
              worldPosition: obj.worldPosition,
              worldScale: obj.worldScale,
            };
          }
          return obj;
        });
        setLoadedObjects(normalized);
      } catch (err) {
        console.error("Failed to parse detected objects:", err);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const applyPreset = (preset) => {
    switch (preset) {
      case "relaxed":
        setEyeHeightRatio(0.3);
        setMinDistanceRatio(0.01);
        setMinSpacingRatio(0.03);
        break;
      case "conservative":
        setEyeHeightRatio(0.35);
        setMinDistanceRatio(0.04);
        setMinSpacingRatio(0.08);
        break;
      case "dense":
        setEyeHeightRatio(0.3);
        setMinDistanceRatio(0.01);
        setMinSpacingRatio(0.02);
        break;
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
          lights: sceneLights,
          cameras: cameras.map((c) => ({
            id: c.id,
            name: c.name,
            position: c.position,
            quaternion: c.quaternion,
            fov: overrideFov ? customFov : c.fov,
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

  const handleRenderSelected = async () => {
    if (!sceneFileId || !selectedCameraId) return;
    const cam = cameras.find((c) => c.id === selectedCameraId);
    if (!cam) return;

    setIsRendering(true);
    setRenderStatus(`Rendering ${cam.name}...`);
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
          lights: sceneLights,
          cameras: [{
            id: cam.id,
            name: cam.name,
            position: cam.position,
            quaternion: cam.quaternion,
            fov: overrideFov ? customFov : cam.fov,
          }],
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
            if (eventType === "log") setRenderLogs((prev) => [...prev, data]);
            else if (eventType === "result") {
              setRenderResults(JSON.parse(data));
              setRenderStatus("Render complete!");
            } else if (eventType === "error") {
              setRenderStatus(`Render failed: ${JSON.parse(data).error}`);
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
              />
              <span>Maximize Viewpoint Entropy</span>
            </label>
            {maximizeEntropy && (
              <div className="advanced-settings" style={{ marginTop: 6 }}>
                <div className="panel-row">
                  <label className="panel-sublabel">Objects file</label>
                  <label className="btn btn-toggle" style={{ fontSize: "0.75rem", padding: "4px 8px" }}>
                    {loadedObjects ? `${loadedObjects.length} loaded` : sessionDetectedObjects.length > 0 ? `${sessionDetectedObjects.length} in session` : "Load JSON"}
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleLoadObjects}
                      style={{ display: "none" }}
                    />
                  </label>
                  {loadedObjects && (
                    <button
                      className="btn-delete"
                      onClick={() => setLoadedObjects(null)}
                      title="Clear objects"
                    >
                      ×
                    </button>
                  )}
                </div>
                {!loadedObjects && sessionDetectedObjects.length === 0 && (
                  <p className="panel-hint">
                    Load a detected_objects.json or detect objects in the Object Detection tab.
                  </p>
                )}
                {!loadedObjects && sessionDetectedObjects.length > 0 && (
                  <p className="panel-hint">
                    Using {sessionDetectedObjects.length} objects from current session. Load JSON to override.
                  </p>
                )}
              </div>
            )}
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={constrainToVolume}
                onChange={(e) => setConstrainToVolume(e.target.checked)}
              />
              <span>Constrain to Volume</span>
            </label>
            {constrainToVolume && (
              <div className="advanced-settings" style={{ marginTop: 6 }}>
                <div className="panel-row">
                  <label className="panel-sublabel">Graph file</label>
                  <label className="btn btn-toggle" style={{ fontSize: "0.75rem", padding: "4px 8px" }}>
                    {volumeGraph ? `${volumeGraph.volumes.length} loaded` : sessionVolumes.length > 0 ? `${sessionVolumes.length} in session` : "Load JSON"}
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleLoadVolumeGraph}
                      style={{ display: "none" }}
                    />
                  </label>
                </div>
                {effectiveVolumes.length > 0 && (
                  <div className="panel-row">
                    <label className="panel-sublabel">Volume</label>
                    <select
                      className="panel-input"
                      value={selectedVolumeId}
                      onChange={(e) => setSelectedVolumeId(e.target.value)}
                      style={{ flex: 1, fontSize: "0.8rem" }}
                    >
                      {effectiveVolumes.map((vol) => (
                        <option key={vol.id} value={vol.id}>{vol.name}</option>
                      ))}
                    </select>
                    {volumeGraph && (
                      <button
                        className="btn-delete"
                        onClick={() => { setVolumeGraph(null); setSelectedVolumeId(""); }}
                        title="Clear loaded file"
                      >
                        ×
                      </button>
                    )}
                  </div>
                )}
                {!volumeGraph && sessionVolumes.length > 0 && (
                  <p className="panel-hint">Using {sessionVolumes.length} volumes from current session.</p>
                )}
              </div>
            )}
            <button
              className="btn-collapse"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? "▾ Advanced Settings" : "▸ Advanced Settings"}
            </button>
            {showAdvanced && (
              <div className="advanced-settings">
                <div className="panel-row">
                  <label className="panel-sublabel">Eye height</label>
                  <input
                    type="range" min="0.1" max="0.8" step="0.05"
                    value={eyeHeightRatio}
                    onChange={(e) => setEyeHeightRatio(parseFloat(e.target.value))}
                    className="cull-slider"
                  />
                  <span className="param-value">{(eyeHeightRatio * 100).toFixed(0)}%</span>
                </div>
                <div className="panel-row">
                  <label className="panel-sublabel">Min wall dist</label>
                  <input
                    type="range" min="0.005" max="0.1" step="0.005"
                    value={minDistanceRatio}
                    onChange={(e) => setMinDistanceRatio(parseFloat(e.target.value))}
                    className="cull-slider"
                  />
                  <span className="param-value">{(minDistanceRatio * 100).toFixed(1)}%</span>
                </div>
                <div className="panel-row">
                  <label className="panel-sublabel">Min spacing</label>
                  <input
                    type="range" min="0.01" max="0.15" step="0.005"
                    value={minSpacingRatio}
                    onChange={(e) => setMinSpacingRatio(parseFloat(e.target.value))}
                    className="cull-slider"
                  />
                  <span className="param-value">{(minSpacingRatio * 100).toFixed(1)}%</span>
                </div>
                <div className="preset-row">
                  <button className="btn-preset" onClick={() => applyPreset("relaxed")}>Relaxed</button>
                  <button className="btn-preset" onClick={() => applyPreset("conservative")}>Conservative</button>
                  <button className="btn-preset" onClick={() => applyPreset("dense")}>Dense</button>
                </div>
              </div>
            )}
            <div className="panel-actions">
              <button className="btn btn-accent" onClick={handleAutoPlace} disabled={!hasScene || isGenerating}>
                {isGenerating ? "Generating..." : "Auto-Place Cameras"}
              </button>
              <button className="btn btn-primary" onClick={onPlaceCamera}>
                Place at View
              </button>
              <label className="btn btn-toggle" style={{ textAlign: "center", cursor: "pointer" }}>
                Load Cameras
                <input
                  type="file"
                  accept=".json"
                  onChange={handleLoadCameras}
                  style={{ display: "none" }}
                />
              </label>
            </div>
            {isGenerating && (
              <div className="barber-pole-container" style={{ marginTop: 6 }}>
                <div className="barber-pole" />
              </div>
            )}
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
                    <button
                      className="btn btn-accent"
                      onClick={() => handleRenderSelected()}
                      disabled={isRendering || !sceneFileId}
                    >
                      Render Selected
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

          {/* Scene Lights */}
          <div className="panel-section">
            <label className="panel-label">Scene Lights ({sceneLights.length})</label>
            <div className="panel-actions">
              <button className="btn btn-toggle" onClick={() => onAddLight("spot")}>
                Add Spot Light
              </button>
              <button className="btn btn-toggle" onClick={() => onAddLight("area")}>
                Add Area Light
              </button>
            </div>
            {sceneLights.length > 0 && (
              <ul className="object-list" style={{ marginTop: 8 }}>
                {sceneLights.map((light, i) => (
                  <li key={light.id} className="object-item">
                    <div style={{ flex: 1 }}>
                      <span className="object-name">{light.type === "area" ? "Area" : "Spot"} {i + 1}</span>
                      <div className="panel-row" style={{ marginTop: 4 }}>
                        <span className="param-value" style={{ minWidth: 24 }}>Pwr</span>
                        <input
                          type="range"
                          className="cull-slider"
                          min="100"
                          max="1000000"
                          step="100"
                          value={light.intensity}
                          onChange={(e) => onUpdateLightIntensity(light.id, parseInt(e.target.value))}
                          style={{ flex: 1 }}
                        />
                        <span className="param-value">{light.intensity >= 1000 ? `${(light.intensity/1000).toFixed(0)}k` : light.intensity}</span>
                      </div>
                      <div className="panel-row" style={{ marginTop: 2 }}>
                        <span className="param-value" style={{ minWidth: 24 }}>Exp</span>
                        <input
                          type="range"
                          className="cull-slider"
                          min="0"
                          max="10"
                          step="0.1"
                          value={light.exposure || 0}
                          onChange={(e) => onUpdateLightExposure(light.id, parseFloat(e.target.value))}
                          style={{ flex: 1 }}
                        />
                        <span className="param-value">{(light.exposure || 0).toFixed(1)}</span>
                      </div>
                      {light.type === "spot" && (
                        <div className="panel-row" style={{ marginTop: 2 }}>
                          <span className="param-value" style={{ minWidth: 24 }}>Ang</span>
                          <input
                            type="range"
                            className="cull-slider"
                            min="10"
                            max="170"
                            step="5"
                            value={light.angle || 120}
                            onChange={(e) => onUpdateLightAngle(light.id, parseInt(e.target.value))}
                            style={{ flex: 1 }}
                          />
                          <span className="param-value">{light.angle || 120}°</span>
                        </div>
                      )}
                    </div>
                    <button
                      className="btn-delete"
                      onClick={() => onDeleteLight(light.id)}
                      title="Delete light"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
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
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={overrideFov}
                onChange={(e) => setOverrideFov(e.target.checked)}
              />
              <span>Override FOV</span>
            </label>
            {overrideFov && (
              <div className="panel-row" style={{ marginTop: 4 }}>
                <label className="panel-sublabel">FOV</label>
                <input
                  type="range"
                  className="cull-slider"
                  min="20"
                  max="120"
                  step="1"
                  value={customFov}
                  onChange={(e) => setCustomFov(parseInt(e.target.value))}
                />
                <span className="param-value">{customFov}°</span>
              </div>
            )}
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
                onChange={(e) => {
                  setOverrideLighting(e.target.checked);
                  if (!e.target.checked && onBrightnessChange) {
                    onBrightnessChange(1.0); // Reset to default brightness
                  }
                }}
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
