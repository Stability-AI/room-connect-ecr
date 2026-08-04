import React from "react";

export default function VolumeList({
  volumes,
  selectedVolumeId,
  onSelect,
  onDelete,
  hasScene,
  isDrawing,
  onStartDraw,
  onExport,
}) {
  return (
    <div className="side-panel">
      <h3>Connectivity</h3>

      <div className="panel-section">
        <label className="panel-label">Volume Drawing</label>
        <p className="panel-hint">
          Define walkable areas by drawing axis-aligned bounding boxes. Connect volumes to create a spatial connectivity graph.
        </p>

        {!hasScene ? (
          <p className="empty-state" style={{ marginTop: 8 }}>Load a scene to start drawing volumes.</p>
        ) : (
          <div className="panel-actions" style={{ marginTop: 8 }}>
            <button
              className={`btn ${isDrawing ? "btn-accent" : "btn-primary"}`}
              onClick={onStartDraw}
            >
              {isDrawing ? "Drawing..." : "Draw Volume"}
            </button>
            {volumes.length > 0 && (
              <button className="btn btn-export" onClick={onExport}>
                Export Graph (JSON)
              </button>
            )}
          </div>
        )}

        {isDrawing && (
          <p className="panel-hint" style={{ marginTop: 8, fontStyle: "italic" }}>
            Click and drag on the ground plane to create a volume. Use handles to adjust, then press Enter to confirm.
          </p>
        )}
      </div>

      {volumes.length > 0 && (
        <div className="panel-section" style={{ borderTop: "1px solid var(--border)", paddingTop: 12, marginTop: 12 }}>
          <label className="panel-label">Volumes ({volumes.length})</label>
          <ul className="object-list">
            {volumes.map((vol) => (
              <li
                key={vol.id}
                className={`object-item ${vol.id === selectedVolumeId ? "selected" : ""}`}
                onClick={() => onSelect(vol.id)}
                style={{ cursor: "pointer" }}
              >
                <div style={{ flex: 1 }}>
                  <span className="object-name">{vol.name}</span>
                  <span style={{ fontSize: "0.65rem", color: "var(--text-secondary)", marginLeft: 6 }}>
                    {vol.id.slice(0, 8)}
                  </span>
                  {vol.connections.length > 0 && (
                    <div style={{ fontSize: "0.7rem", color: "var(--text-secondary)", marginTop: 2 }}>
                      → {vol.connections.map((cId) => {
                        const connected = volumes.find((v) => v.id === cId);
                        return connected ? connected.name : "?";
                      }).join(", ")}
                    </div>
                  )}
                </div>
                <button
                  className="btn-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(vol.id);
                  }}
                  title="Delete volume"
                  style={{ background: "none", border: "none", color: "var(--text-secondary)", cursor: "pointer", fontSize: "0.9rem" }}
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {volumes.length === 0 && hasScene && !isDrawing && (
        <p className="panel-hint" style={{ marginTop: 12, fontStyle: "italic" }}>
          No volumes defined yet. Click "Draw Volume" to start defining walkable areas.
        </p>
      )}
    </div>
  );
}
