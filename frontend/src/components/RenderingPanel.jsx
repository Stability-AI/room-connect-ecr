import React, { useState, useEffect } from "react";
import * as THREE from "three";
import EditableValue from "./EditableValue";

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
  onUpdateLightSize,
  onDeleteLight,
  onLoadLights,
  sessionVolumes = [],
  sessionDetectedObjects = [],
  uploadProgress,
  selectedLightId,
  onSelectLight,
  analysisData,
  onAnalyzeDistribution,
  persistedState,
  onPersistedStateChange,
  backdropImage,
  onBackdropChange,
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
  const [colorManagement, setColorManagement] = useState("standard");
  const [isGenerating, setIsGenerating] = useState(false);

  // Use persisted state if available, fall back to local
  const ps = persistedState || {};
  const isRendering = ps.isRendering || false;
  const renderStatus = ps.renderStatus || "";
  const renderLogs = ps.renderLogs || [];
  const renderResults = ps.renderResults || null;
  const showDebugConsole = ps.showDebugConsole || false;
  const isSplatRenderingPersisted = ps.isSplatRendering || false;
  const splatResultsPersisted = ps.splatResults || null;
  const isFlyRenderingPersisted = ps.isFlyRendering || false;
  const flyResultPersisted = ps.flyResult || null;

  const updateState = (updates) => {
    if (onPersistedStateChange) onPersistedStateChange((s) => ({ ...s, ...updates }));
  };
  const setIsRendering = (v) => updateState({ isRendering: v });
  const setRenderStatus = (v) => updateState({ renderStatus: v });
  const setRenderLogs = (v) => updateState({ renderLogs: typeof v === "function" ? v(ps.renderLogs || []) : v });
  const setRenderResults = (v) => updateState({ renderResults: v });
  const setShowDebugConsole = (v) => updateState({ showDebugConsole: v });

  // Splat dataset state
  const [splatCount, setSplatCount] = useState(200);
  const [splatPreset, setSplatPreset] = useState("balanced");
  const [splatDepth, setSplatDepth] = useState(false);
  const [splatHdr, setSplatHdr] = useState(false);
  const [splatHdrDepth, setSplatHdrDepth] = useState("16");
  const [splatLogTransform, setSplatLogTransform] = useState(true);
  const [showSplatDialog, setShowSplatDialog] = useState(null); // null | "warning" | "confirm"
  const isSplatRendering = isSplatRenderingPersisted;
  const splatResults = splatResultsPersisted;
  const setIsSplatRendering = (v) => updateState({ isSplatRendering: v });
  const setSplatResults = (v) => updateState({ splatResults: v });

  // Flythrough state
  const [flyFrames, setFlyFrames] = useState(300);
  const [flyFps, setFlyFps] = useState(30);
  const [flyFormat, setFlyFormat] = useState("png");
  const [flyDepth, setFlyDepth] = useState(false);
  const isFlyRendering = isFlyRenderingPersisted;
  const flyResult = flyResultPersisted;
  const setIsFlyRendering = (v) => updateState({ isFlyRendering: v });
  const setFlyResult = (v) => updateState({ flyResult: v });

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

  const handleBackdropUpload = async (file) => {
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext !== "png" && ext !== "exr" && ext !== "hdr") return;

    const fileId = `backdrop_${Date.now()}`;
    const url = URL.createObjectURL(file);

    onBackdropChange({
      fileId,
      filename: file.name,
      format: ext,
      url,
      useAsBackground: true,
      useForLighting: true,
      strength: 1.0,
      exposure: 1.0,
      _uploading: true,
    });

    try {
      const { uploadSceneChunked } = await import("../utils/sceneUpload");
      const result = await uploadSceneChunked(file);
      onBackdropChange({
        fileId: `${result.id}_${result.filename}`,
        filename: file.name,
        format: ext,
        url,
        useAsBackground: true,
        useForLighting: true,
        strength: 1.0,
        exposure: 1.0,
        backendPath: result.path,
        _uploading: false,
      });
    } catch (err) {
      console.error("Backdrop upload failed:", err);
    }
  };

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
          colorManagement: colorManagement,
          backdropImage: backdropImage && !backdropImage._uploading ? {
            fileId: backdropImage.fileId,
            filename: backdropImage.filename,
            strength: backdropImage.strength,
            useForLighting: backdropImage.useForLighting,
          } : undefined,
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
          colorManagement: colorManagement,
          backdropImage: backdropImage && !backdropImage._uploading ? {
            fileId: backdropImage.fileId,
            filename: backdropImage.filename,
            strength: backdropImage.strength,
            useForLighting: backdropImage.useForLighting,
          } : undefined,
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

  // --- Splat dataset handlers ---

  const SPLAT_PRESETS = {
    draft:    { label: "Draft",    res: "2560x1440", samples: 32,   est: "20-40 min" },
    fast:     { label: "Fast",     res: "1920x1080", samples: 256,  est: "3-6 hours" },
    balanced: { label: "Balanced", res: "2560x1440", samples: 512,  est: "8-16 hours" },
    hero:     { label: "Hero",     res: "3840x2160", samples: 1024, est: "24-48 hours" },
  };

  const handleSplatGenerate = () => {
    const hasLights = sceneLights.length > 0 || overrideLighting;
    if (!hasLights) {
      setShowSplatDialog("warning");
    } else {
      setShowSplatDialog("confirm");
    }
  };

  const getSplatPlacementParams = () => ({
    minSpacingRatio: Math.max(0.002, 0.03 * (50 / splatCount)),
    minDistanceRatio: Math.max(0.003, 0.01 * (50 / splatCount)),
    splatMode: true,
  });

  const handleSplatPreviewCameras = () => {
    setShowSplatDialog(null);
    if (onAutoPlaceCameras) {
      onAutoPlaceCameras(splatCount, false, getSplatPlacementParams());
    }
  };

  const startSplatRender = async () => {
    setIsSplatRendering(true);
    setRenderStatus("Starting splat dataset render...");
    setRenderLogs([]);
    setSplatResults(null);

    try {
      const fov = propFovOverride || 60;
      const response = await fetch("/api/render-splat-dataset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneId: sceneFileId,
          preset: splatPreset,
          generateDepth: splatDepth,
          hdrFormat: splatHdr ? `exr${splatHdrDepth}` : null,
          logTransform: splatHdr && splatLogTransform,
          overrideLighting: overrideLighting,
          lightingBrightness: lightingBrightness,
          lights: sceneLights,
          colorManagement: colorManagement,
          backdropImage: backdropImage && !backdropImage._uploading ? {
            fileId: backdropImage.fileId,
            filename: backdropImage.filename,
            strength: backdropImage.strength,
            useForLighting: backdropImage.useForLighting,
          } : undefined,
          cameras: cameras.map((c) => ({
            id: c.id,
            name: c.name,
            position: c.position,
            quaternion: c.quaternion,
            fov: fov,
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
        buffer = lines.pop() || "";

        let currentEvent = null;
        for (const line of lines) {
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ") && currentEvent) {
            const data = line.slice(6);
            if (currentEvent === "log") {
              setRenderLogs((prev) => [...prev, data]);
              setRenderStatus(data);
            } else if (currentEvent === "result") {
              try {
                const result = JSON.parse(data);
                setSplatResults(result);
                setRenderStatus(`Splat dataset complete: ${result.frameCount} frames`);
              } catch (e) { /* ignore parse errors */ }
            } else if (currentEvent === "error") {
              try {
                const err = JSON.parse(data);
                setRenderStatus(`Splat render failed: ${err.error}`);
              } catch (e) {
                setRenderStatus("Splat render failed");
              }
            }
            currentEvent = null;
          }
        }
      }
    } catch (err) {
      setRenderStatus(`Splat render failed: ${err.message}`);
    } finally {
      setIsSplatRendering(false);
    }
  };

  const handleSplatRenderCurrent = () => {
    setShowSplatDialog(null);
    if (cameras.length === 0) return;
    startSplatRender();
  };

  const handleSplatStartRender = async () => {
    setShowSplatDialog(null);
    if (onAutoPlaceCameras) {
      onAutoPlaceCameras(splatCount, false, getSplatPlacementParams());
      await new Promise((r) => setTimeout(r, splatCount * 110));
    }
    startSplatRender();
  };

  const handleSplatDownload = () => {
    if (splatResults && splatResults.zip) {
      const a = document.createElement("a");
      a.href = splatResults.zip;
      a.download = "splat_dataset.zip";
      a.click();
    }
  };

  // --- Flythrough handler ---
  const handleRenderFlythrough = async () => {
    if (!sceneFileId || cameras.length < 2) return;
    setIsFlyRendering(true);
    setFlyResult(null);
    setRenderLogs([]);
    setRenderStatus("Starting flythrough render...");

    try {
      const fov = propFovOverride || 60;
      const response = await fetch("/api/render-flythrough", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneId: sceneFileId,
          cameras: cameras.map((c) => ({
            id: c.id, name: c.name, position: c.position,
            quaternion: c.quaternion, fov: fov,
          })),
          totalFrames: flyFrames,
          fps: flyFps,
          format: flyFormat,
          generateDepth: flyDepth,
          overrideLighting: overrideLighting,
          lightingBrightness: lightingBrightness,
          lights: sceneLights,
          colorManagement: colorManagement,
          backdropImage: backdropImage && !backdropImage._uploading ? {
            fileId: backdropImage.fileId,
            filename: backdropImage.filename,
            strength: backdropImage.strength,
            useForLighting: backdropImage.useForLighting,
          } : undefined,
          width: renderWidth,
          height: renderHeight,
          samples: samples,
        }),
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let currentEvent = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (line.startsWith("event: ")) { currentEvent = line.slice(7); }
          else if (line.startsWith("data: ") && currentEvent) {
            const data = line.slice(6);
            if (currentEvent === "log") { setRenderLogs((p) => [...p, data]); setRenderStatus(data); }
            else if (currentEvent === "result") {
              try { const r = JSON.parse(data); setFlyResult(r); setRenderStatus(`Flythrough complete: ${r.frames} frames`); } catch (e) {}
            } else if (currentEvent === "error") {
              try { setRenderStatus(`Flythrough failed: ${JSON.parse(data).error}`); } catch (e) { setRenderStatus("Flythrough failed"); }
            }
            currentEvent = null;
          }
        }
      }
    } catch (err) {
      setRenderStatus(`Flythrough failed: ${err.message}`);
    } finally {
      setIsFlyRendering(false);
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
                  <EditableValue value={eyeHeightRatio} onChange={setEyeHeightRatio} min={0.1} max={0.8} defaultValue={0.3} format={(v) => `${(v * 100).toFixed(0)}%`} />
                </div>
                <div className="panel-row">
                  <label className="panel-sublabel">Min wall dist</label>
                  <input
                    type="range" min="0.005" max="0.1" step="0.005"
                    value={minDistanceRatio}
                    onChange={(e) => setMinDistanceRatio(parseFloat(e.target.value))}
                    className="cull-slider"
                  />
                  <EditableValue value={minDistanceRatio} onChange={setMinDistanceRatio} min={0.005} max={0.1} defaultValue={0.02} format={(v) => `${(v * 100).toFixed(1)}%`} />
                </div>
                <div className="panel-row">
                  <label className="panel-sublabel">Min spacing</label>
                  <input
                    type="range" min="0.01" max="0.15" step="0.005"
                    value={minSpacingRatio}
                    onChange={(e) => setMinSpacingRatio(parseFloat(e.target.value))}
                    className="cull-slider"
                  />
                  <EditableValue value={minSpacingRatio} onChange={setMinSpacingRatio} min={0.01} max={0.15} defaultValue={0.05} format={(v) => `${(v * 100).toFixed(1)}%`} />
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

            {cameras.length >= 3 && (
              <div style={{ marginTop: 8 }}>
                <button
                  className="btn btn-toggle"
                  onClick={onAnalyzeDistribution}
                  style={{ width: "100%" }}
                >
                  Analyze Distribution
                </button>
                {analysisData && (
                  <div style={{ marginTop: 8, padding: "8px 10px", background: "var(--bg-secondary)", borderRadius: 4, fontSize: "0.78rem", lineHeight: 1.6 }}>
                    <div><strong>Quality Score: {analysisData.score}/100</strong></div>
                    <div style={{ color: analysisData.spatial.cv < 0.3 ? "#00cc44" : analysisData.spatial.cv < 0.7 ? "#ffcc00" : "#ff3300" }}>
                      Spatial: CV={analysisData.spatial.cv.toFixed(2)} ({analysisData.interpretation})
                    </div>
                    <div>Angular: {analysisData.angular.meanAngle.toFixed(1)}° mean divergence</div>
                    <div>Ray hits: {analysisData.coverage.hitRate?.toFixed(1)}% of rays hit geometry</div>
                    <div>Multi-view: {analysisData.coverage.multiViewPct.toFixed(1)}% of hit faces seen by 3+ cameras</div>
                    <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)" }}>{analysisData.coverage.uniqueFacesHit?.toLocaleString()} unique faces observed</div>
                  </div>
                )}
              </div>
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
                  <li
                    key={light.id}
                    className={`object-item${selectedLightId === light.id ? " selected" : ""}`}
                    onClick={() => onSelectLight && onSelectLight(light.id)}
                    style={{ cursor: "pointer" }}
                  >
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
                        <EditableValue value={light.intensity} onChange={(v) => onUpdateLightIntensity(light.id, v)} min={100} max={1000000} defaultValue={10000} format={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                      </div>
                      <div className="panel-row" style={{ marginTop: 2 }}>
                        <span className="param-value" style={{ minWidth: 24 }}>Exp</span>
                        <input
                          type="range"
                          className="cull-slider"
                          min="0"
                          max="1"
                          step="0.01"
                          value={light.exposure || 0}
                          onChange={(e) => onUpdateLightExposure(light.id, parseFloat(e.target.value))}
                          style={{ flex: 1 }}
                        />
                        <EditableValue value={light.exposure || 0} onChange={(v) => onUpdateLightExposure(light.id, v)} min={0} max={1} defaultValue={0} format={(v) => v.toFixed(2)} />
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
                          <EditableValue value={light.angle || 120} onChange={(v) => onUpdateLightAngle(light.id, v)} min={10} max={170} defaultValue={120} format={(v) => `${v}°`} />
                        </div>
                      )}
                      {light.type === "area" && (
                        <>
                          <div className="panel-row" style={{ marginTop: 2 }}>
                            <span className="param-value" style={{ minWidth: 24 }}>X</span>
                            <input
                              type="range"
                              className="cull-slider"
                              min="0.1"
                              max="10"
                              step="0.1"
                              value={light.sizeX || 1.0}
                              onChange={(e) => onUpdateLightSize(light.id, "sizeX", parseFloat(e.target.value))}
                              style={{ flex: 1 }}
                            />
                            <EditableValue value={light.sizeX || 1.0} onChange={(v) => onUpdateLightSize(light.id, "sizeX", v)} min={0.1} max={20} defaultValue={1.0} format={(v) => v.toFixed(1)} />
                          </div>
                          <div className="panel-row" style={{ marginTop: 2 }}>
                            <span className="param-value" style={{ minWidth: 24 }}>Y</span>
                            <input
                              type="range"
                              className="cull-slider"
                              min="0.1"
                              max="10"
                              step="0.1"
                              value={light.sizeY || 1.0}
                              onChange={(e) => onUpdateLightSize(light.id, "sizeY", parseFloat(e.target.value))}
                              style={{ flex: 1 }}
                            />
                            <EditableValue value={light.sizeY || 1.0} onChange={(v) => onUpdateLightSize(light.id, "sizeY", v)} min={0.1} max={20} defaultValue={1.0} format={(v) => v.toFixed(1)} />
                          </div>
                        </>
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
            {sceneLights.length > 0 && (
              <div className="panel-actions" style={{ marginTop: 8 }}>
                <button className="btn btn-export" onClick={() => {
                  const blob = new Blob([JSON.stringify({ lights: sceneLights }, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "scene_lights.json";
                  a.click();
                  URL.revokeObjectURL(url);
                }}>
                  Save Lights
                </button>
                <label className="btn btn-toggle" style={{ textAlign: "center", cursor: "pointer" }}>
                  Load Lights
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        try {
                          const data = JSON.parse(ev.target.result);
                          if (data.lights && onLoadLights) {
                            onLoadLights(data.lights);
                          }
                        } catch (err) {
                          console.error("Failed to parse lights JSON:", err);
                        }
                      };
                      reader.readAsText(file);
                      e.target.value = "";
                    }}
                    style={{ display: "none" }}
                  />
                </label>
              </div>
            )}
            {sceneLights.length === 0 && (
              <div className="panel-actions" style={{ marginTop: 8 }}>
                <label className="btn btn-toggle" style={{ textAlign: "center", cursor: "pointer" }}>
                  Load Lights
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        try {
                          const data = JSON.parse(ev.target.result);
                          if (data.lights && onLoadLights) {
                            onLoadLights(data.lights);
                          }
                        } catch (err) {
                          console.error("Failed to parse lights JSON:", err);
                        }
                      };
                      reader.readAsText(file);
                      e.target.value = "";
                    }}
                    style={{ display: "none" }}
                  />
                </label>
              </div>
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
                <EditableValue value={customFov} onChange={(v) => setCustomFov(Math.round(v))} min={20} max={120} defaultValue={60} format={(v) => `${v}°`} />
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
                <EditableValue value={lightingBrightness} onChange={(v) => { setLightingBrightness(v); if (onBrightnessChange) onBrightnessChange(v); }} min={0.5} max={4.0} defaultValue={1.5} format={(v) => `${v.toFixed(1)}x`} style={{ fontSize: "0.75rem", minWidth: 30 }} />
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
            <div className="panel-row" style={{ marginTop: 6 }}>
              <label className="panel-sublabel">Color management</label>
              <select
                value={colorManagement}
                onChange={(e) => setColorManagement(e.target.value)}
                style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", fontSize: "0.8rem" }}
              >
                <option value="standard">Standard (accurate colors)</option>
                <option value="filmic">Filmic (compressed highlights)</option>
              </select>
            </div>
          </div>

          {/* Backdrop Image */}
          <div className="panel-section" style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 16 }}>
            <label className="panel-label">Backdrop Image (World Environment)</label>
            <p className="panel-hint">Upload an equirectangular panorama (PNG, EXR, or HDR) for skybox and IBL lighting.</p>

            {!backdropImage ? (
              <label
                style={{
                  display: "block", padding: "16px 12px", border: "2px dashed var(--border)",
                  borderRadius: 6, textAlign: "center", cursor: "pointer",
                  color: "var(--text-secondary)", fontSize: "0.8rem", marginTop: 8,
                }}
                onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--accent)"; }}
                onDragLeave={(e) => { e.currentTarget.style.borderColor = "var(--border)"; }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.currentTarget.style.borderColor = "var(--border)";
                  const file = e.dataTransfer.files[0];
                  if (file) handleBackdropUpload(file);
                }}
              >
                Drop image or click to browse
                <br /><span style={{ fontSize: "0.7rem" }}>Supported: PNG, EXR, HDR (equirectangular)</span>
                <input
                  type="file"
                  accept=".png,.exr,.hdr"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files[0];
                    if (file) handleBackdropUpload(file);
                    e.target.value = "";
                  }}
                />
              </label>
            ) : (
              <div style={{ marginTop: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontSize: "0.78rem", color: "var(--text-primary)" }}>
                    {backdropImage.filename}
                    <span style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginLeft: 6 }}>
                      ({backdropImage.format.toUpperCase()})
                    </span>
                  </span>
                  <button
                    className="btn-delete"
                    onClick={() => onBackdropChange(null)}
                    title="Remove backdrop"
                  >
                    ×
                  </button>
                </div>

                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={backdropImage.useAsBackground}
                    onChange={(e) => onBackdropChange({ ...backdropImage, useAsBackground: e.target.checked })}
                  />
                  <span>Show in viewport preview</span>
                </label>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={backdropImage.useForLighting}
                    onChange={(e) => onBackdropChange({ ...backdropImage, useForLighting: e.target.checked })}
                  />
                  <span>Use for lighting (IBL)</span>
                </label>

                <div className="panel-row" style={{ marginTop: 6 }}>
                  <label className="panel-sublabel">Strength</label>
                  <input
                    type="range" className="cull-slider" min="0.1" max="5.0" step="0.1"
                    value={backdropImage.strength}
                    onChange={(e) => onBackdropChange({ ...backdropImage, strength: parseFloat(e.target.value) })}
                    style={{ flex: 1 }}
                  />
                  <EditableValue
                    value={backdropImage.strength}
                    onChange={(v) => onBackdropChange({ ...backdropImage, strength: v })}
                    min={0.1} max={5.0} defaultValue={1.0}
                    format={(v) => v.toFixed(1)}
                    style={{ minWidth: 30 }}
                  />
                </div>

                <div className="panel-row" style={{ marginTop: 4 }}>
                  <label className="panel-sublabel">Exposure</label>
                  <input
                    type="range" className="cull-slider" min="0.1" max="5.0" step="0.1"
                    value={backdropImage.exposure}
                    onChange={(e) => onBackdropChange({ ...backdropImage, exposure: parseFloat(e.target.value) })}
                    style={{ flex: 1 }}
                  />
                  <EditableValue
                    value={backdropImage.exposure}
                    onChange={(v) => onBackdropChange({ ...backdropImage, exposure: v })}
                    min={0.1} max={5.0} defaultValue={1.0}
                    format={(v) => v.toFixed(1)}
                    style={{ minWidth: 30 }}
                  />
                </div>
              </div>
            )}
          </div>

          {!sceneFileId && uploadProgress !== null && uploadProgress !== undefined && (
            <div className="upload-status-notice">
              Uploading scene to backend ({(uploadProgress * 100).toFixed(0)}%)... Rendering will be available once upload completes.
            </div>
          )}
          {!sceneFileId && (uploadProgress === null || uploadProgress === undefined) && hasScene && (
            <div className="upload-status-notice upload-error">
              Backend upload failed. Try reloading the scene.
            </div>
          )}
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

      {/* --- Gaussian Splat Dataset Section --- */}
      {hasScene && (
        <div className="panel-section" style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 16 }}>
          <label className="panel-label">Gaussian Splat Dataset</label>
          <p className="panel-hint" style={{ marginBottom: 8 }}>
            Generate a Nerfstudio-compatible training dataset with high-fidelity renders and camera transforms.
          </p>

          <div className="panel-row">
            <label className="panel-sublabel">Views</label>
            <input
              type="range"
              className="cull-slider"
              min={80}
              max={400}
              step={10}
              value={splatCount}
              onChange={(e) => setSplatCount(parseInt(e.target.value))}
              style={{ flex: 1 }}
            />
            <EditableValue value={splatCount} onChange={(v) => setSplatCount(Math.round(v))} min={80} max={400} defaultValue={200} format={(v) => String(v)} />
          </div>

          <div className="panel-row">
            <label className="panel-sublabel">Preset</label>
            <select
              value={splatPreset}
              onChange={(e) => setSplatPreset(e.target.value)}
              style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", fontSize: "0.8rem" }}
            >
              {Object.entries(SPLAT_PRESETS).map(([key, p]) => (
                <option key={key} value={key}>{p.label} — {p.res}, {p.samples} samples</option>
              ))}
            </select>
          </div>

          <p className="panel-hint" style={{ fontSize: "0.72rem", marginTop: 4 }}>
            Est. render time (CPU): {SPLAT_PRESETS[splatPreset].est} for {splatCount} views
          </p>

          <label className="checkbox-row" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={splatDepth} onChange={(e) => setSplatDepth(e.target.checked)} />
            <span>Include depth maps (for depth-supervised training)</span>
          </label>

          <label className="checkbox-row" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={splatHdr} onChange={(e) => setSplatHdr(e.target.checked)} />
            <span title="For HDR-aware splat methods only. Standard splatfacto expects PNG.">Render as HDR (OpenEXR)</span>
          </label>
          {splatHdr && (
            <>
              <div className="panel-row" style={{ marginTop: 4, marginLeft: 20 }}>
                <label className="panel-sublabel">Bit depth</label>
                <select
                  value={splatHdrDepth}
                  onChange={(e) => setSplatHdrDepth(e.target.value)}
                  style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", fontSize: "0.8rem" }}
                >
                  <option value="16">16-bit half (recommended)</option>
                  <option value="32">32-bit float</option>
                </select>
              </div>
              <label className="checkbox-row" style={{ marginTop: 4, marginLeft: 20 }}>
                <input type="checkbox" checked={splatLogTransform} onChange={(e) => setSplatLogTransform(e.target.checked)} />
                <span title="Applies log(1+x) to compress dynamic range for stable training. Invertible via exp(y)-1.">Apply log(1+x) transform (recommended)</span>
              </label>
            </>
          )}

          <div className="panel-actions" style={{ marginTop: 12 }}>
            <button
              className="btn btn-accent"
              onClick={handleSplatGenerate}
              disabled={!sceneFileId || isRendering || isSplatRendering}
              style={{ width: "100%" }}
            >
              {isSplatRendering ? "Generating Dataset..." : "Generate Splat Dataset"}
            </button>
          </div>

          {isSplatRendering && (
            <div style={{ marginTop: 8 }}>
              <div className="barber-pole-container"><div className="barber-pole" /></div>
            </div>
          )}

          {splatResults && (
            <div className="panel-actions" style={{ marginTop: 8 }}>
              <button className="btn btn-export" onClick={handleSplatDownload}>
                Download Splat Dataset (ZIP)
              </button>
            </div>
          )}
        </div>
      )}

      {/* --- Camera Flythrough Section --- */}
      {hasScene && cameras.length >= 2 && (
        <div className="panel-section" style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 16 }}>
          <label className="panel-label">Camera Flythrough</label>
          <p className="panel-hint" style={{ marginBottom: 8 }}>
            Render interpolated camera path between placed cameras.
          </p>
          <div className="panel-row">
            <label className="panel-sublabel">Frames</label>
            <input type="number" className="panel-input panel-input-small" min={10} max={3000}
              value={flyFrames} onChange={(e) => setFlyFrames(parseInt(e.target.value) || 300)} />
          </div>
          <div className="panel-row">
            <label className="panel-sublabel">FPS</label>
            <input type="number" className="panel-input panel-input-small" min={1} max={120}
              value={flyFps} onChange={(e) => setFlyFps(parseInt(e.target.value) || 30)} />
          </div>
          <p className="panel-hint" style={{ fontSize: "0.72rem" }}>
            Duration: {(flyFrames / flyFps).toFixed(1)}s | {cameras.length} waypoints
          </p>
          <div className="panel-row">
            <label className="panel-sublabel">Format</label>
            <select value={flyFormat} onChange={(e) => setFlyFormat(e.target.value)}
              style={{ flex: 1, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", fontSize: "0.8rem" }}>
              <option value="png">PNG 8-bit</option>
              <option value="exr">EXR 16-bit HDR</option>
            </select>
          </div>
          <label className="checkbox-row" style={{ marginTop: 4 }}>
            <input type="checkbox" checked={flyDepth} onChange={(e) => setFlyDepth(e.target.checked)} />
            <span>Generate depth maps</span>
          </label>
          <div className="panel-actions" style={{ marginTop: 8 }}>
            <button className="btn btn-primary" onClick={handleRenderFlythrough}
              disabled={isFlyRendering || !sceneFileId || cameras.length < 2} style={{ width: "100%" }}>
              {isFlyRendering ? "Rendering Flythrough..." : `Render Flythrough (${flyFrames} frames)`}
            </button>
          </div>
          {isFlyRendering && (
            <div style={{ marginTop: 8 }}>
              <div className="barber-pole-container"><div className="barber-pole" /></div>
            </div>
          )}
          {flyResult?.zip && (
            <div className="panel-actions" style={{ marginTop: 8 }}>
              <button className="btn btn-export" onClick={() => { const a = document.createElement("a"); a.href = flyResult.zip; a.download = "flythrough.zip"; a.click(); }}>
                Download Flythrough (ZIP)
              </button>
            </div>
          )}
        </div>
      )}

      {/* --- Splat Dialogs --- */}
      {showSplatDialog === "warning" && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h2>No Lights Detected</h2>
            <p style={{ fontSize: "0.9rem", lineHeight: 1.5 }}>
              Your scene has no user-placed lights and override lighting is not enabled.
              Gaussian Splat training data requires well-lit images — dark or unlit areas will produce poor quality splats.
            </p>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              Either add scene lights or enable "Override lighting" before generating the dataset.
            </p>
            <div className="dialog-actions" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={() => setShowSplatDialog(null)}>
                Add Lights First
              </button>
              <button className="btn btn-accent" onClick={() => { setShowSplatDialog("confirm"); }}>
                Proceed Anyway
              </button>
              <button className="btn" onClick={() => setShowSplatDialog(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {showSplatDialog === "confirm" && (
        <div className="dialog-overlay">
          <div className="dialog">
            <h2>Generate Splat Dataset</h2>
            <p style={{ fontSize: "0.9rem", lineHeight: 1.5 }}>
              This will render <strong>{splatCount} views</strong> at <strong>{SPLAT_PRESETS[splatPreset].res}</strong> ({SPLAT_PRESETS[splatPreset].label} preset).
              <br />Estimated time: <strong>{SPLAT_PRESETS[splatPreset].est}</strong>.
            </p>
            <p style={{ fontSize: "0.85rem", color: "var(--text-secondary)", lineHeight: 1.5 }}>
              <strong>Recommendation:</strong> Before rendering, preview the camera placements to verify coverage,
              and do 1-2 test renders with "Render Views" to check lighting and materials.
              Issues found after rendering {splatCount} frames waste significant time.
            </p>
            <div className="dialog-actions" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn btn-primary" onClick={handleSplatPreviewCameras}>
                Preview Cameras Only
              </button>
              {cameras.length > 0 && (
                <button className="btn btn-accent" onClick={handleSplatRenderCurrent}>
                  Render Current Cameras ({cameras.length})
                </button>
              )}
              <button className="btn btn-accent" onClick={handleSplatStartRender}>
                New Cameras + Render ({splatCount})
              </button>
              <button className="btn" onClick={() => setShowSplatDialog(null)}>Cancel</button>
            </div>
          </div>
        </div>
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
