import React, { useRef } from "react";

const TABS = [
  { id: "connectivity", label: "Connectivity" },
  { id: "detection", label: "Object Detection" },
  { id: "rendering", label: "Rendering" },
];

export default function Toolbar({
  activeTab,
  onTabChange,
  onFileLoad,
  onStartDraw,
  onExport,
  isDrawing,
  hasScene,
  hasVolumes,
  wireframe,
  onToggleWireframe,
  orthographic,
  onToggleOrthographic,
}) {
  const fileInputRef = useRef();

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      onFileLoad(file);
      e.target.value = "";
    }
  };

  return (
    <div className="toolbar">
      <div className="toolbar-left">
        <div className="toolbar-brand">
          <h1>Room Connect</h1>
        </div>
        <div className="toolbar-tabs">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              className={`tab-btn ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => onTabChange(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      <div className="toolbar-actions">
        <input
          ref={fileInputRef}
          type="file"
          accept=".glb,.gltf"
          onChange={handleFileChange}
          style={{ display: "none" }}
        />
        <button
          className="btn btn-primary"
          onClick={() => fileInputRef.current.click()}
        >
          Load Scene (.glb)
        </button>

        {activeTab === "connectivity" && (
          <>
            <button
              className="btn btn-accent"
              onClick={onStartDraw}
              disabled={!hasScene || isDrawing}
            >
              {isDrawing ? "Drawing..." : "Draw Volume"}
            </button>
            <button
              className="btn btn-export"
              onClick={onExport}
              disabled={!hasVolumes}
            >
              Export Graph (JSON)
            </button>
          </>
        )}

        <span className="toolbar-separator" />

        <button
          className={`btn btn-toggle ${wireframe ? "active" : ""}`}
          onClick={onToggleWireframe}
          disabled={!hasScene}
        >
          {wireframe ? "Shaded" : "Wireframe"}
        </button>
        <button
          className={`btn btn-toggle ${orthographic ? "active" : ""}`}
          onClick={onToggleOrthographic}
          disabled={!hasScene}
        >
          {orthographic ? "Perspective" : "Ortho"}
        </button>
      </div>
    </div>
  );
}
