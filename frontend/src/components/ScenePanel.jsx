import React, { useState } from "react";
import EditableValue from "./EditableValue";

const PC_PRESETS = {
  fast:     { targetPoints: 250000,   minDensityRatio: 0.15, curvatureGamma: 0.5, label: "Fast (250k)" },
  standard: { targetPoints: 750000,   minDensityRatio: 0.12, curvatureGamma: 0.5, label: "Standard (750k)" },
  dense:    { targetPoints: 1500000,  minDensityRatio: 0.10, curvatureGamma: 0.5, label: "Dense (1.5M)" },
};

export default function ScenePanel({
  hasScene,
  sceneFileId,
  cameras,
  sceneLights,
  overrideLighting,
  lightingBrightness,
  renderWidth,
  renderHeight,
  samples,
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState(null);
  const [analysisError, setAnalysisError] = useState(null);
  const [showConsole, setShowConsole] = useState(false);
  const [consoleLogs, setConsoleLogs] = useState([]);

  const [includeCameras, setIncludeCameras] = useState(true);
  const [includeLights, setIncludeLights] = useState(true);
  const [includeOverride, setIncludeOverride] = useState(true);
  const [includeSettings, setIncludeSettings] = useState(true);

  // Point cloud state
  const [isGeneratingPC, setIsGeneratingPC] = useState(false);
  const [pcResult, setPcResult] = useState(null);
  const [pcError, setPcError] = useState(null);
  const [pcPreset, setPcPreset] = useState("standard");
  const [showPcAdvanced, setShowPcAdvanced] = useState(false);
  const [pcTargetPoints, setPcTargetPoints] = useState(750000);
  const [pcMinDensity, setPcMinDensity] = useState(0.12);
  const [pcGamma, setPcGamma] = useState(0.5);
  const [pcPercentileClip, setPcPercentileClip] = useState(0.95);
  const [pcSeed, setPcSeed] = useState(42);
  const [pcRandomSeed, setPcRandomSeed] = useState(false);
  const [pcSampleColors, setPcSampleColors] = useState(true);
  const [pcSampleNormals, setPcSampleNormals] = useState(true);
  const [pcCoordSystem, setPcCoordSystem] = useState("COLMAP");

  // Point cloud stats state
  const [isComputingStats, setIsComputingStats] = useState(false);
  const [pcStats, setPcStats] = useState(null);
  const [pcStatsError, setPcStatsError] = useState(null);

  const anyBusy = isExporting || isAnalyzing || isGeneratingPC || isComputingStats;

  const addLog = (msg) => setConsoleLogs((prev) => [...prev, msg]);

  const handlePresetChange = (preset) => {
    setPcPreset(preset);
    const p = PC_PRESETS[preset];
    if (p) {
      setPcTargetPoints(p.targetPoints);
      setPcMinDensity(p.minDensityRatio);
      setPcGamma(p.curvatureGamma);
    }
  };

  const handleExportBlend = async () => {
    if (!sceneFileId) return;
    setIsExporting(true);
    setExportResult(null);
    setConsoleLogs([]);
    addLog("Starting scene export...");

    try {
      const fov = 60;
      addLog(`Sending export request (${cameras.length} cameras, ${sceneLights.length} lights)`);
      const response = await fetch("/api/export-blend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneId: sceneFileId,
          cameras: includeCameras ? cameras.map((c) => ({
            id: c.id, name: c.name, position: c.position,
            quaternion: c.quaternion, fov: c.fov || fov,
          })) : [],
          lights: includeLights ? sceneLights : [],
          overrideLighting: includeOverride && overrideLighting,
          lightingBrightness: lightingBrightness,
          renderSettings: includeSettings ? {
            width: renderWidth, height: renderHeight, samples: samples,
          } : {},
        }),
      });

      const result = await response.json();
      if (result.success) {
        setExportResult(result);
        addLog(`Export complete: ${result.cameras} cameras, ${result.lights} lights`);
      } else {
        setExportResult({ error: result.error || "Export failed" });
        addLog(`Export failed: ${result.error}`);
      }
    } catch (err) {
      setExportResult({ error: err.message });
      addLog(`Export error: ${err.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadBlend = () => {
    if (exportResult && exportResult.zip) {
      const a = document.createElement("a");
      a.href = exportResult.zip;
      a.download = "scene_export.zip";
      a.click();
    }
  };

  const handleAnalyzeScene = async () => {
    if (!sceneFileId) return;
    setIsAnalyzing(true);
    setAnalysisResult(null);
    setAnalysisError(null);
    setConsoleLogs([]);
    addLog("Starting scene analysis...");
    addLog("Loading scene into Blender (this may take a moment)...");

    try {
      const response = await fetch("/api/scene-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneId: sceneFileId }),
      });

      const result = await response.json();

      if (result.error) {
        setAnalysisError(result.error);
        addLog(`Analysis failed: ${result.error}`);
      } else {
        setAnalysisResult(result);
        addLog(`Analysis complete: ${result.total_meshes} meshes, ${result.aggregate?.total_vertices?.toLocaleString()} vertices`);
      }
    } catch (err) {
      setAnalysisError(err.message);
      addLog(`Analysis error: ${err.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleDownloadAnalysis = () => {
    if (!analysisResult) return;
    const blob = new Blob([JSON.stringify(analysisResult, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "scene_analysis.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleGeneratePointCloud = async () => {
    if (!sceneFileId) return;
    setIsGeneratingPC(true);
    setPcResult(null);
    setPcError(null);
    setPcStats(null);
    setPcStatsError(null);
    setConsoleLogs([]);
    addLog(`Generating point cloud (${pcTargetPoints.toLocaleString()} target points)...`);
    addLog("Loading scene and joining meshes...");

    try {
      const response = await fetch("/api/generate-point-cloud", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneId: sceneFileId,
          targetPoints: pcTargetPoints,
          minDensityRatio: pcMinDensity,
          curvatureGamma: pcGamma,
          percentileClip: pcPercentileClip,
          seed: pcRandomSeed ? null : pcSeed,
          sampleColors: pcSampleColors,
          sampleNormals: pcSampleNormals,
          coordSystem: pcCoordSystem,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setPcResult(result);
        addLog(`Point cloud generated: ${result.stats.total_points.toLocaleString()} points`);
        addLog(`Materials: ${result.stats.textured_materials} textured, ${result.stats.constant_materials} constant`);
        addLog(`Coordinates: ${result.stats.coord_system}, Colors: ${result.stats.colors}, Normals: ${result.stats.normals ? "yes" : "no"}`);
      } else {
        setPcError(result.error || "Generation failed");
        addLog(`Generation failed: ${result.error}`);
      }
    } catch (err) {
      setPcError(err.message);
      addLog(`Generation error: ${err.message}`);
    } finally {
      setIsGeneratingPC(false);
    }
  };

  const handleDownloadPC = () => {
    if (pcResult && pcResult.zip) {
      const a = document.createElement("a");
      a.href = pcResult.zip;
      a.download = "point_cloud.zip";
      a.click();
    }
  };

  const handleComputeStats = async () => {
    if (!pcResult?.plyPath) return;
    setIsComputingStats(true);
    setPcStats(null);
    setPcStatsError(null);
    addLog("Computing point cloud statistics (k-NN density)...");

    try {
      const response = await fetch("/api/point-cloud-stats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          plyPath: pcResult.plyPath,
          statsSample: 80000,
          knnK: 12,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setPcStats(result);
        addLog(`Stats computed: Pearson r = ${result.pearson_r.toFixed(4)}, ${result.total_points.toLocaleString()} points`);
      } else {
        setPcStatsError(result.error || "Stats failed");
        addLog(`Stats failed: ${result.error}`);
      }
    } catch (err) {
      setPcStatsError(err.message);
      addLog(`Stats error: ${err.message}`);
    } finally {
      setIsComputingStats(false);
    }
  };

  const handleDownloadStats = () => {
    if (!pcStats) return;
    const blob = new Blob([JSON.stringify(pcStats, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "curvature_density_stats.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const interpretCorrelation = (r) => {
    if (r >= 0.5) return { text: "Strong correlation", color: "#4caf50" };
    if (r >= 0.3) return { text: "Good correlation", color: "#8bc34a" };
    if (r >= 0.1) return { text: "Weak correlation", color: "#ff9800" };
    return { text: "No correlation", color: "#f44336" };
  };

  if (!hasScene) {
    return (
      <div className="side-panel">
        <h3>Scene</h3>
        <p className="empty-state">Load a scene to access scene tools.</p>
      </div>
    );
  }

  const agg = analysisResult?.aggregate;

  return (
    <div className="side-panel">
      <h3>Scene</h3>

      {/* Export Blend */}
      <div className="panel-section">
        <label className="panel-label">Scene Export</label>
        <p className="panel-hint">Export the complete scene as a Blender .blend file with cameras, lights, and render settings.</p>

        <label className="checkbox-row">
          <input type="checkbox" checked={includeCameras} onChange={(e) => setIncludeCameras(e.target.checked)} />
          <span>Cameras ({cameras.length} placed)</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={includeLights} onChange={(e) => setIncludeLights(e.target.checked)} />
          <span>User lights ({sceneLights.length} placed)</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={includeOverride} onChange={(e) => setIncludeOverride(e.target.checked)} />
          <span>Override lighting {overrideLighting ? "(enabled)" : "(disabled)"}</span>
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={includeSettings} onChange={(e) => setIncludeSettings(e.target.checked)} />
          <span>Render settings ({renderWidth}x{renderHeight}, {samples} samples)</span>
        </label>

        <div className="panel-actions" style={{ marginTop: 8 }}>
          <button
            className="btn btn-primary"
            onClick={handleExportBlend}
            disabled={!sceneFileId || anyBusy}
            style={{ width: "100%" }}
          >
            {isExporting ? "Exporting..." : "Export Complete Blender Scene"}
          </button>
        </div>

        {isExporting && (
          <div style={{ marginTop: 8 }}>
            <div className="barber-pole-container"><div className="barber-pole" /></div>
          </div>
        )}

        {exportResult && exportResult.zip && (
          <div className="panel-actions" style={{ marginTop: 8 }}>
            <button className="btn btn-export" onClick={handleDownloadBlend}>
              Download .blend (ZIP)
            </button>
          </div>
        )}
        {exportResult && exportResult.error && (
          <div className="upload-status-notice upload-error" style={{ marginTop: 8 }}>
            Export failed: {exportResult.error}
          </div>
        )}
      </div>

      {/* Scene Analysis */}
      <div className="panel-section" style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 16 }}>
        <label className="panel-label">Scene Analysis</label>
        <p className="panel-hint">Analyze mesh topology, PBR materials, and geometry quality.</p>

        <div className="panel-actions">
          <button
            className="btn btn-accent"
            onClick={handleAnalyzeScene}
            disabled={!sceneFileId || anyBusy}
            style={{ width: "100%" }}
          >
            {isAnalyzing ? "Analyzing..." : "Analyze Scene"}
          </button>
        </div>

        {isAnalyzing && (
          <div style={{ marginTop: 8 }}>
            <div className="barber-pole-container"><div className="barber-pole" /></div>
            <p className="render-status" style={{ marginTop: 4 }}>Loading and analyzing scene...</p>
          </div>
        )}

        {analysisError && (
          <div className="upload-status-notice upload-error" style={{ marginTop: 8 }}>
            Analysis failed: {analysisError}
          </div>
        )}

        {analysisResult && agg && (
          <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--bg-secondary)", borderRadius: 4, fontSize: "0.78rem", lineHeight: 1.7 }}>
            <div><strong>{analysisResult.scene_name}</strong></div>
            <div style={{ marginTop: 4 }}>
              Objects: {analysisResult.total_objects} ({analysisResult.total_meshes} meshes, {analysisResult.total_lights} lights)
            </div>
            <div>Vertices: {agg.total_vertices?.toLocaleString()} | Faces: {agg.total_faces?.toLocaleString()}</div>
            <div>Materials: {agg.total_materials} ({agg.materials_with_principled_bsdf} Principled BSDF)</div>
            {agg.pbr_texture_types_found?.length > 0 && (
              <div>PBR textures: {agg.pbr_texture_types_found.join(", ")}</div>
            )}
            <div>UV maps: {agg.has_uv_maps ? "Yes" : "No"}</div>
            <div>Watertight: {agg.watertight_meshes}/{analysisResult.total_meshes} meshes</div>
            <div>Intersecting faces: {agg.meshes_with_intersecting_faces} meshes</div>
            {analysisResult.scene_bounds && (
              <div style={{ marginTop: 4, fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                Bounds: {analysisResult.scene_bounds.dimensions.map((d) => d.toFixed(0)).join(" × ")}
              </div>
            )}

            <div className="panel-actions" style={{ marginTop: 8 }}>
              <button className="btn btn-export" onClick={handleDownloadAnalysis}>
                Download Full Report (JSON)
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Point Cloud Generation */}
      <div className="panel-section" style={{ borderTop: "1px solid var(--border)", paddingTop: 16, marginTop: 16 }}>
        <label className="panel-label">Point Cloud Generation</label>
        <p className="panel-hint">Generate a curvature-weighted point cloud for 3DGS initialization. Edges and detail get dense coverage; flat surfaces stay covered.</p>

        {/* Preset */}
        <div style={{ marginBottom: 8 }}>
          <label className="panel-label" style={{ fontSize: "0.72rem", marginBottom: 4 }}>Preset</label>
          <select
            value={pcPreset}
            onChange={(e) => handlePresetChange(e.target.value)}
            style={{ width: "100%", padding: "4px 8px", fontSize: "0.8rem", background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4 }}
          >
            {Object.entries(PC_PRESETS).map(([key, p]) => (
              <option key={key} value={key}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* Advanced settings toggle */}
        <div
          style={{ cursor: "pointer", fontSize: "0.75rem", color: "var(--text-secondary)", marginBottom: 8, userSelect: "none" }}
          onClick={() => setShowPcAdvanced(!showPcAdvanced)}
        >
          {showPcAdvanced ? "▾" : "▸"} Advanced Settings
        </div>

        {showPcAdvanced && (
          <div style={{ padding: "8px 10px", background: "var(--bg-secondary)", borderRadius: 4, marginBottom: 8, fontSize: "0.76rem" }}>
            {/* Target Points */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span>Target Points</span>
              <EditableValue
                value={pcTargetPoints}
                onChange={(v) => { setPcTargetPoints(Math.round(v)); setPcPreset("custom"); }}
                min={100000}
                max={2000000}
                format={(v) => v.toLocaleString()}
                style={{ width: 80, textAlign: "right" }}
              />
            </div>

            {/* Min Density Ratio */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span>Min Density Ratio</span>
              <EditableValue
                value={pcMinDensity}
                onChange={(v) => { setPcMinDensity(v); setPcPreset("custom"); }}
                min={0.01}
                max={1.0}
                format={(v) => v.toFixed(2)}
                style={{ width: 50, textAlign: "right" }}
              />
            </div>
            <input
              type="range"
              min={0.01}
              max={1.0}
              step={0.01}
              value={pcMinDensity}
              onChange={(e) => { setPcMinDensity(parseFloat(e.target.value)); setPcPreset("custom"); }}
              style={{ width: "100%", marginBottom: 6 }}
            />

            {/* Curvature Gamma */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span>Curvature Gamma</span>
              <EditableValue
                value={pcGamma}
                onChange={(v) => { setPcGamma(v); setPcPreset("custom"); }}
                min={0.1}
                max={2.0}
                format={(v) => v.toFixed(2)}
                style={{ width: 50, textAlign: "right" }}
              />
            </div>
            <input
              type="range"
              min={0.1}
              max={2.0}
              step={0.05}
              value={pcGamma}
              onChange={(e) => { setPcGamma(parseFloat(e.target.value)); setPcPreset("custom"); }}
              style={{ width: "100%", marginBottom: 6 }}
            />

            {/* Percentile Clip */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span>Percentile Clip</span>
              <EditableValue
                value={pcPercentileClip}
                onChange={setPcPercentileClip}
                min={0.80}
                max={1.0}
                format={(v) => v.toFixed(2)}
                style={{ width: 50, textAlign: "right" }}
              />
            </div>
            <input
              type="range"
              min={0.80}
              max={1.0}
              step={0.01}
              value={pcPercentileClip}
              onChange={(e) => setPcPercentileClip(parseFloat(e.target.value))}
              style={{ width: "100%", marginBottom: 6 }}
            />

            {/* Seed */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
              <span>Seed</span>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <label style={{ fontSize: "0.72rem", display: "flex", alignItems: "center", gap: 3 }}>
                  <input type="checkbox" checked={pcRandomSeed} onChange={(e) => setPcRandomSeed(e.target.checked)} />
                  Random
                </label>
                {!pcRandomSeed && (
                  <EditableValue
                    value={pcSeed}
                    onChange={(v) => setPcSeed(Math.round(v))}
                    min={0}
                    max={99999}
                    format={(v) => String(v)}
                    style={{ width: 50, textAlign: "right" }}
                  />
                )}
              </div>
            </div>

            {/* Feature toggles */}
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 6, marginTop: 6 }}>
              <label className="checkbox-row" style={{ marginBottom: 4 }}>
                <input type="checkbox" checked={pcSampleColors} onChange={(e) => setPcSampleColors(e.target.checked)} />
                <span>Sample scene colours (sRGB)</span>
              </label>
              <label className="checkbox-row" style={{ marginBottom: 4 }}>
                <input type="checkbox" checked={pcSampleNormals} onChange={(e) => setPcSampleNormals(e.target.checked)} />
                <span>Include vertex normals</span>
              </label>
            </div>

            {/* Coordinate System */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
              <span>Coordinate System</span>
              <select
                value={pcCoordSystem}
                onChange={(e) => setPcCoordSystem(e.target.value)}
                style={{ padding: "2px 6px", fontSize: "0.76rem", background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 3 }}
              >
                <option value="COLMAP">COLMAP (Y-down)</option>
                <option value="BLENDER">Blender (Z-up)</option>
              </select>
            </div>
          </div>
        )}

        {/* Generate button */}
        <div className="panel-actions">
          <button
            className="btn btn-primary"
            onClick={handleGeneratePointCloud}
            disabled={!sceneFileId || anyBusy}
            style={{ width: "100%" }}
          >
            {isGeneratingPC ? "Generating..." : `Generate Point Cloud (${(pcTargetPoints / 1000).toFixed(0)}k pts)`}
          </button>
        </div>

        {isGeneratingPC && (
          <div style={{ marginTop: 8 }}>
            <div className="barber-pole-container"><div className="barber-pole" /></div>
            <p className="render-status" style={{ marginTop: 4 }}>Joining meshes, computing curvature, sampling points...</p>
          </div>
        )}

        {pcError && (
          <div className="upload-status-notice upload-error" style={{ marginTop: 8 }}>
            Generation failed: {pcError}
          </div>
        )}

        {/* Generation results */}
        {pcResult && pcResult.stats && (
          <div style={{ marginTop: 12, padding: "10px 12px", background: "var(--bg-secondary)", borderRadius: 4, fontSize: "0.78rem", lineHeight: 1.7 }}>
            <div><strong>Point Cloud Generated</strong></div>
            <div>Points: {pcResult.stats.total_points.toLocaleString()}</div>
            <div>Triangles: {pcResult.stats.total_faces.toLocaleString()}</div>
            <div>Materials: {pcResult.stats.textured_materials} textured, {pcResult.stats.constant_materials} constant</div>
            <div>Curvature range: [{pcResult.stats.curvature_range[0].toFixed(4)}, {pcResult.stats.curvature_range[1].toFixed(4)}] rad</div>
            <div>Clip at p{Math.round(pcPercentileClip * 100)}: {pcResult.stats.percentile_clip_value.toFixed(4)}</div>
            <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)", marginTop: 2 }}>
              {pcResult.stats.coord_system} coords | {pcResult.stats.colors} colours | normals: {pcResult.stats.normals ? "yes" : "no"} | seed: {pcResult.stats.seed ?? "random"}
            </div>

            <div className="panel-actions" style={{ marginTop: 8 }}>
              <button className="btn btn-export" onClick={handleDownloadPC}>
                Download Point Cloud (ZIP)
              </button>
            </div>

            {/* Stats button */}
            <div className="panel-actions" style={{ marginTop: 8 }}>
              <button
                className="btn btn-accent"
                onClick={handleComputeStats}
                disabled={anyBusy}
                style={{ width: "100%" }}
              >
                {isComputingStats ? "Computing Stats..." : "Generate Point Cloud Stats"}
              </button>
            </div>

            {isComputingStats && (
              <div style={{ marginTop: 8 }}>
                <div className="barber-pole-container"><div className="barber-pole" /></div>
                <p className="render-status" style={{ marginTop: 4 }}>Computing k-NN density and correlation...</p>
              </div>
            )}

            {pcStatsError && (
              <div className="upload-status-notice upload-error" style={{ marginTop: 8 }}>
                Stats failed: {pcStatsError}
              </div>
            )}

            {pcStats && (
              <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--bg-primary)", borderRadius: 4, fontSize: "0.76rem", lineHeight: 1.6 }}>
                <div><strong>Curvature–Density Correlation</strong></div>
                <div style={{ marginTop: 4 }}>
                  Pearson r:{" "}
                  <span style={{ color: interpretCorrelation(pcStats.pearson_r).color, fontWeight: 600 }}>
                    {pcStats.pearson_r.toFixed(4)}
                  </span>
                  {" "}— {interpretCorrelation(pcStats.pearson_r).text}
                </div>
                <div>Linear fit: slope = {pcStats.linear_fit.slope.toFixed(4)}, intercept = {pcStats.linear_fit.intercept.toFixed(4)}</div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-secondary)" }}>
                  Sample: {pcStats.stats_sample.toLocaleString()} pts, k = {pcStats.knn_k}
                </div>

                {/* Quartile table */}
                <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", fontSize: "0.72rem" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th style={{ textAlign: "left", padding: "3px 4px" }}>Curvature</th>
                      <th style={{ textAlign: "right", padding: "3px 4px" }}>Points</th>
                      <th style={{ textAlign: "right", padding: "3px 4px" }}>Mean Density</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pcStats.quartiles.map((q, i) => (
                      <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "3px 4px" }}>{q.range}</td>
                        <td style={{ textAlign: "right", padding: "3px 4px" }}>{q.point_count.toLocaleString()}</td>
                        <td style={{ textAlign: "right", padding: "3px 4px" }}>{q.mean_density.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div className="panel-actions" style={{ marginTop: 8 }}>
                  <button className="btn btn-export" onClick={handleDownloadStats}>
                    Download Stats (JSON)
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Console */}
      <div style={{ marginTop: 16 }}>
        <label className="checkbox-row">
          <input type="checkbox" checked={showConsole} onChange={(e) => setShowConsole(e.target.checked)} />
          <span>Show console</span>
        </label>
      </div>

      {showConsole && (
        <div className="debug-console" style={{ marginTop: 8 }}>
          <div className="debug-console-header">
            <span>Scene Console</span>
          </div>
          <div className="debug-console-body">
            {consoleLogs.length === 0 ? (
              <span className="debug-empty">No activity yet.</span>
            ) : (
              consoleLogs.map((line, i) => (
                <div key={i} className="debug-line">{line}</div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
