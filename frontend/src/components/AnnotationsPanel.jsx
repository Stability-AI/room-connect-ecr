import React, { useState } from "react";

function hexToRgbFloat(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

const CONNECTION_TYPES = [
  { id: "adjacent_to", label: "Adjacent to", color: "#ffffff" },
  { id: "on_top_of", label: "On top of", color: "#00cc44" },
  { id: "inside_of", label: "Inside of", color: "#0088ff" },
  { id: "part_of", label: "Part of", color: "#ffcc00" },
  { id: "supports", label: "Supports", color: "#ff8800" },
  { id: "supported_by", label: "Supported by", color: "#ff8800" },
];

const INVERSE_MAP = {
  on_top_of: "supported_by", supported_by: "on_top_of",
  supports: "supported_by",
};

export default function AnnotationsPanel({
  hasScene,
  sceneFileId,
  sceneFilename,
  detectedObjects,
  showOOBBs,
  onDetect,
  onToggleOOBBs,
  onClearDetection,
  onCull,
  onMerge,
  onExportObjects,
  annotations,
  onUpdateAnnotation,
  connections,
  onAddConnection,
  onRemoveConnection,
  selectedAnnotationId,
  onSelectAnnotation,
  pickedMesh,
  onAddToPool,
  onClearPickedMesh,
  onRemoveFromPool,
  onRenameInPool,
  onClearAllFromPool,
  renderState,
  onRenderStateChange,
}) {
  const [connectingFrom, setConnectingFrom] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [filterTerms, setFilterTerms] = useState("");
  const [exclusive, setExclusive] = useState(false);
  const [poolRenameValue, setPoolRenameValue] = useState("");
  const [connectionType, setConnectionType] = useState("adjacent_to");

  const isRendering = renderState.isRendering;
  const renderResult = renderState.renderResult;
  const renderLogs = renderState.renderLogs;
  const showConsole = renderState.showConsole;

  const setIsRendering = (v) => onRenderStateChange((s) => ({ ...s, isRendering: v }));
  const setRenderResult = (v) => onRenderStateChange((s) => ({ ...s, renderResult: v }));
  const setRenderLogs = (v) => onRenderStateChange((s) => ({ ...s, renderLogs: typeof v === "function" ? v(s.renderLogs) : v }));
  const setShowConsole = (v) => onRenderStateChange((s) => ({ ...s, showConsole: v }));
  const [mvViews, setMvViews] = useState(16);
  const [mvResolution, setMvResolution] = useState(512);
  const [mvSamples, setMvSamples] = useState(32);
  const [mvDepth, setMvDepth] = useState(false);
  const [mvBgColor, setMvBgColor] = useState("#ffffff");
  const [mvTransparentBg, setMvTransparentBg] = useState(false);

  const addLog = (msg) => setRenderLogs((prev) => [...prev, msg]);

  const handleDescriptionChange = (objName, desc) => {
    onUpdateAnnotation(objName, { description: desc });
  };

  const handleStartConnect = (objName) => {
    if (connectingFrom === objName) {
      setConnectingFrom(null);
    } else {
      setConnectingFrom(objName);
    }
  };

  const handleCompleteConnect = (targetName) => {
    if (!connectingFrom || connectingFrom === targetName) return;
    onAddConnection({
      source: connectingFrom,
      target: targetName,
      type: connectionType,
    });
    const inverse = INVERSE_MAP[connectionType];
    if (inverse) {
      onAddConnection({ source: targetName, target: connectingFrom, type: inverse });
    }
    setConnectingFrom(null);
  };

  const handleRenderMultiView = async (objects) => {
    if (!sceneFileId || objects.length === 0) return;
    setIsRendering(true);
    setRenderResult(null);
    setRenderLogs([]);
    addLog(`Starting multi-view render for ${objects.length} object(s)...`);

    try {
      const response = await fetch("/api/render-object-multiview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sceneId: sceneFileId,
          objects: objects.map((o) => ({
            name: o.name,
            description: annotations[o.name]?.description || "",
            oobb: { center: o.center, halfExtents: o.halfExtents, rotation: o.rotation },
            worldPosition: o.worldPosition,
          })),
          numViews: mvViews,
          resolution: mvResolution,
          samples: mvSamples,
          generateDepth: mvDepth,
          bgColor: hexToRgbFloat(mvBgColor),
          transparentBg: mvTransparentBg,
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
          if (line.startsWith("event: ")) {
            currentEvent = line.slice(7);
          } else if (line.startsWith("data: ") && currentEvent) {
            const data = line.slice(6);
            if (currentEvent === "log") { addLog(data); }
            else if (currentEvent === "result") {
              try { setRenderResult(JSON.parse(data)); addLog("Render complete!"); } catch (e) {}
            } else if (currentEvent === "error") {
              try { addLog(`Error: ${JSON.parse(data).error}`); } catch (e) { addLog("Render failed"); }
            }
            currentEvent = null;
          }
        }
      }
    } catch (err) {
      addLog(`Error: ${err.message}`);
    } finally {
      setIsRendering(false);
    }
  };

  const handleDownload = () => {
    if (renderResult?.zip) {
      const a = document.createElement("a");
      a.href = renderResult.zip;
      a.download = "object_renders.zip";
      a.click();
    }
  };

  const handleExportAnnotations = () => {
    const exportData = {
      objects: detectedObjects.map((obj) => ({
        name: obj.name,
        description: annotations[obj.name]?.description || "",
        oobb: { center: obj.center, halfExtents: obj.halfExtents, rotation: obj.rotation },
        worldPosition: obj.worldPosition,
        worldScale: obj.worldScale,
        connections: connections
          .filter((c) => c.source === obj.name)
          .map((c) => ({ target: c.target, type: c.type })),
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "annotations.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!hasScene) {
    return (
      <div className="side-panel">
        <h3>Annotations & Connections</h3>
        <p className="empty-state">Load a scene to start annotating.</p>
      </div>
    );
  }

  return (
    <div className="side-panel">
      <h3>Annotations</h3>

      {/* Object Detection */}
      <div className="panel-section">
        <label className="panel-label">Object Detection</label>
        <p className="panel-hint">Filter scene meshes by name to detect and annotate objects.</p>
        <div className="panel-row" style={{ marginTop: 8 }}>
          <input
            type="text"
            className="panel-input"
            placeholder="e.g. chair, desk, furniture"
            value={filterTerms}
            onChange={(e) => setFilterTerms(e.target.value)}
            style={{ flex: 1 }}
            onKeyDown={(e) => { if (e.key === "Enter" && filterTerms.trim()) onDetect(filterTerms, exclusive); }}
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center", flexWrap: "wrap" }}>
          <label className="checkbox-row" style={{ marginBottom: 0 }}>
            <input type="checkbox" checked={exclusive} onChange={(e) => setExclusive(e.target.checked)} />
            <span style={{ fontSize: "0.75rem" }}>Exclude mode</span>
          </label>
          <button className="btn btn-primary" style={{ fontSize: "0.7rem", padding: "3px 10px" }}
            onClick={() => { if (filterTerms.trim()) onDetect(filterTerms, exclusive); }}
            disabled={!hasScene || !filterTerms.trim()}>
            Detect
          </button>
          {detectedObjects.length > 0 && (
            <>
              <button className="btn btn-toggle" style={{ fontSize: "0.65rem", padding: "2px 6px" }} onClick={onToggleOOBBs}>
                {showOOBBs ? "Hide" : "Show"} OOBBs
              </button>
              <button className="btn btn-toggle" style={{ fontSize: "0.65rem", padding: "2px 6px" }} onClick={() => onCull(0.5)}>
                Cull
              </button>
              <button className="btn btn-toggle" style={{ fontSize: "0.65rem", padding: "2px 6px" }} onClick={() => onMerge(0.5)}>
                Merge
              </button>
            </>
          )}
        </div>
      </div>

      {/* Manual Annotation - always visible */}
      <div className="panel-section" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
        <label className="panel-label">Manual Annotation</label>
        <p className="panel-hint">Double-click any mesh in the 3D viewport to pick it.</p>

        {pickedMesh ? (
          <div style={{ padding: "8px 10px", background: "var(--bg-secondary)", borderRadius: 4, marginTop: 8 }}>
            <div style={{ fontSize: "0.78rem", fontWeight: 600, color: "#ff8800" }}>Picked: {pickedMesh.name}</div>
            <div style={{ marginTop: 6 }}>
              <input
                type="text"
                placeholder="Rename (optional)"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                style={{ width: "100%", fontSize: "0.75rem", padding: 4, background: "var(--bg-primary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 3 }}
              />
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
              <button className="btn btn-primary" style={{ fontSize: "0.65rem", padding: "3px 8px" }}
                onClick={() => {
                  const finalName = renameValue.trim() || pickedMesh.name;
                  setRenameValue("");
                  onAddToPool(finalName);
                }}>
                {renameValue.trim() ? `Add as "${renameValue.trim()}"` : "Add to Pool"}
              </button>
              <button className="btn btn-toggle" style={{ fontSize: "0.65rem", padding: "3px 8px" }}
                onClick={() => { setRenameValue(""); onClearPickedMesh(); }}>
                Dismiss
              </button>
            </div>
          </div>
        ) : (
          <p className="panel-hint" style={{ marginTop: 4, fontStyle: "italic" }}>No mesh picked. Double-click in the viewport.</p>
        )}
      </div>

      {/* Object list with descriptions */}
      <div className="panel-section" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
        <label className="panel-label">Object Pool ({detectedObjects.length})</label>
        <ul className="object-list" style={{ maxHeight: 300 }}>
          {detectedObjects.map((obj) => {
            const isSelected = selectedAnnotationId === obj.name;
            const isConnecting = connectingFrom === obj.name;
            const desc = annotations[obj.name]?.description || "";

            return (
              <li
                key={obj.name}
                className={`object-item${isSelected ? " selected" : ""}`}
                onClick={() => onSelectAnnotation(obj.name)}
                style={{ cursor: "pointer", flexDirection: "column", alignItems: "stretch" }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span className="object-name" style={{ fontSize: "0.75rem", flex: 1 }}>{obj.name}</span>
                  {isSelected && (
                    <button
                      style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.9rem", padding: "0 4px" }}
                      onClick={(e) => { e.stopPropagation(); onRemoveFromPool(obj.name); }}
                      title="Remove from pool"
                    >×</button>
                  )}
                  {connectingFrom && connectingFrom !== obj.name && (
                    <button
                      className="btn btn-accent"
                      style={{ fontSize: "0.65rem", padding: "2px 6px" }}
                      onClick={(e) => { e.stopPropagation(); handleCompleteConnect(obj.name); }}
                    >
                      Connect Here
                    </button>
                  )}
                </div>

                {isSelected && (
                  <div style={{ marginTop: 6 }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                      <input
                        type="text"
                        placeholder="Rename..."
                        value={poolRenameValue}
                        onChange={(e) => setPoolRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && poolRenameValue.trim()) {
                            onRenameInPool(obj.name, poolRenameValue.trim());
                            setPoolRenameValue("");
                          }
                        }}
                        style={{ flex: 1, fontSize: "0.72rem", padding: 3, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 3 }}
                      />
                      {poolRenameValue.trim() && (
                        <button className="btn btn-accent" style={{ fontSize: "0.6rem", padding: "2px 6px" }}
                          onClick={() => { onRenameInPool(obj.name, poolRenameValue.trim()); setPoolRenameValue(""); }}>
                          Rename
                        </button>
                      )}
                    </div>
                    <textarea
                      placeholder="Add description..."
                      value={desc}
                      onChange={(e) => handleDescriptionChange(obj.name, e.target.value)}
                      style={{
                        width: "100%", minHeight: 40, fontSize: "0.75rem", padding: 4,
                        background: "var(--bg-secondary)", color: "var(--text-primary)",
                        border: "1px solid var(--border)", borderRadius: 3, resize: "vertical",
                      }}
                    />
                    <div style={{ display: "flex", gap: 4, marginTop: 4, flexWrap: "wrap" }}>
                      <button
                        className={`btn btn-toggle${isConnecting ? " selected" : ""}`}
                        style={{ fontSize: "0.65rem", padding: "2px 6px" }}
                        onClick={() => handleStartConnect(obj.name)}
                      >
                        {isConnecting ? "Cancel Connect" : "Connect To..."}
                      </button>
                      <button
                        className="btn btn-accent"
                        style={{ fontSize: "0.65rem", padding: "2px 6px" }}
                        onClick={() => handleRenderMultiView([obj])}
                        disabled={isRendering || !sceneFileId}
                      >
                        Render Multi-View
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {connectingFrom && (
          <div style={{ marginTop: 8 }}>
            <label className="panel-sublabel">Relationship type:</label>
            <select
              value={connectionType}
              onChange={(e) => setConnectionType(e.target.value)}
              style={{ width: "100%", marginTop: 4, background: "var(--bg-secondary)", color: "var(--text-primary)", border: "1px solid var(--border)", borderRadius: 4, padding: "4px 8px", fontSize: "0.78rem" }}
            >
              {CONNECTION_TYPES.map((ct) => (
                <option key={ct.id} value={ct.id}>{ct.label}</option>
              ))}
            </select>
            <p className="panel-hint" style={{ marginTop: 4 }}>Click "Connect Here" on the target object.</p>
          </div>
        )}
      </div>

      {/* Connections list */}
      {connections.length > 0 && (
        <div className="panel-section" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
          <label className="panel-label">Connections ({connections.length})</label>
          <ul className="object-list" style={{ maxHeight: 150 }}>
            {connections.map((conn, i) => (
              <li key={i} className="object-item" style={{ fontSize: "0.72rem" }}>
                <span>{conn.source} → <em>{conn.type.replace("_", " ")}</em> → {conn.target}</span>
                <button
                  style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.8rem" }}
                  onClick={() => onRemoveConnection(i)}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Multi-view settings - only when pool has objects */}
      {detectedObjects.length > 0 && (
      <div className="panel-section" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
        <label className="panel-label">Multi-View Rendering</label>
        <div className="panel-row">
          <label className="panel-sublabel">Views</label>
          <input type="number" className="panel-input panel-input-small" min={4} max={32} value={mvViews} onChange={(e) => setMvViews(parseInt(e.target.value) || 16)} />
        </div>
        <div className="panel-row">
          <label className="panel-sublabel">Resolution</label>
          <input type="number" className="panel-input panel-input-small" min={128} max={2048} step={128} value={mvResolution} onChange={(e) => setMvResolution(parseInt(e.target.value) || 512)} />
        </div>
        <div className="panel-row">
          <label className="panel-sublabel">Samples</label>
          <input type="number" className="panel-input panel-input-small" min={1} max={1024} value={mvSamples} onChange={(e) => setMvSamples(parseInt(e.target.value) || 32)} />
        </div>
        <label className="checkbox-row" style={{ marginTop: 4 }}>
          <input type="checkbox" checked={mvDepth} onChange={(e) => setMvDepth(e.target.checked)} />
          <span>Generate depth maps (16-bit EXR)</span>
        </label>
        <label className="checkbox-row" style={{ marginTop: 4 }}>
          <input type="checkbox" checked={mvTransparentBg} onChange={(e) => setMvTransparentBg(e.target.checked)} />
          <span>Transparent background (RGBA PNG)</span>
        </label>
        {!mvTransparentBg && (
          <div className="panel-row" style={{ marginTop: 4 }}>
            <label className="panel-sublabel">Background</label>
            <input
              type="color"
              value={mvBgColor}
              onChange={(e) => setMvBgColor(e.target.value)}
              style={{ width: 32, height: 24, padding: 0, border: "1px solid var(--border)", borderRadius: 3, cursor: "pointer" }}
            />
            <span style={{ fontSize: "0.72rem", color: "var(--text-secondary)", marginLeft: 4 }}>{mvBgColor}</span>
          </div>
        )}
        <div className="panel-actions" style={{ marginTop: 8 }}>
          <button
            className="btn btn-accent"
            onClick={() => handleRenderMultiView(detectedObjects)}
            disabled={isRendering || !sceneFileId}
            style={{ width: "100%" }}
          >
            {isRendering ? "Rendering..." : `Render All Objects (${detectedObjects.length})`}
          </button>
        </div>
        {isRendering && (
          <div style={{ marginTop: 8 }}>
            <div className="barber-pole-container"><div className="barber-pole" /></div>
          </div>
        )}
        {renderResult?.zip && (
          <div className="panel-actions" style={{ marginTop: 8 }}>
            <button className="btn btn-export" onClick={handleDownload}>Download Object Renders (ZIP)</button>
          </div>
        )}
      </div>
      )}

      {/* Pool management */}
      <div className="panel-actions" style={{ marginTop: 8 }}>
        <button className="btn btn-toggle" onClick={onClearAllFromPool} disabled={detectedObjects.length === 0}>
          Clear All Objects
        </button>
      </div>

      

      {/* Export */}
      <div className="panel-actions" style={{ marginTop: 12 }}>
        <button className="btn btn-export" onClick={handleExportAnnotations} style={{ width: "100%" }}>
          Export Annotations (JSON)
        </button>
      </div>

      {/* Console */}
      <div style={{ marginTop: 12 }}>
        <label className="checkbox-row">
          <input type="checkbox" checked={showConsole} onChange={(e) => setShowConsole(e.target.checked)} />
          <span>Show console</span>
        </label>
      </div>
      {showConsole && (
        <div className="debug-console" style={{ marginTop: 8 }}>
          <div className="debug-console-header"><span>Annotations Console</span></div>
          <div className="debug-console-body">
            {renderLogs.length === 0 ? (
              <span className="debug-empty">No activity yet.</span>
            ) : renderLogs.map((line, i) => <div key={i} className="debug-line">{line}</div>)}
          </div>
        </div>
      )}
    </div>
  );
}

export { CONNECTION_TYPES };
