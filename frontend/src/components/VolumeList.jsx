import React from "react";

export default function VolumeList({ volumes, selectedVolumeId, onSelect, onDelete }) {
  if (volumes.length === 0) {
    return (
      <div className="volume-list">
        <h3>Volumes</h3>
        <p className="empty-state">No volumes defined yet. Load a scene and draw volumes to define walkable areas.</p>
      </div>
    );
  }

  return (
    <div className="volume-list">
      <h3>Volumes ({volumes.length})</h3>
      <ul>
        {volumes.map((vol) => (
          <li
            key={vol.id}
            className={`volume-item ${vol.id === selectedVolumeId ? "selected" : ""}`}
            onClick={() => onSelect(vol.id)}
          >
            <div className="volume-item-info">
              <span className="volume-name">{vol.name}</span>
              <span className="volume-id">{vol.id.slice(0, 8)}</span>
              {vol.connections.length > 0 && (
                <span className="volume-connections">
                  → {vol.connections.map((cId) => {
                    const connected = volumes.find((v) => v.id === cId);
                    return connected ? connected.name : "?";
                  }).join(", ")}
                </span>
              )}
            </div>
            <button
              className="btn-delete"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(vol.id);
              }}
              title="Delete volume"
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
