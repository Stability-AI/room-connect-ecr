import React, { useState } from "react";

export default function VolumeDialog({ existingVolumes, onConfirm, onCancel }) {
  const [name, setName] = useState("");
  const [selectedConnections, setSelectedConnections] = useState([]);

  const handleToggleConnection = (id) => {
    setSelectedConnections((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onConfirm(name.trim(), selectedConnections);
  };

  return (
    <div className="dialog-overlay">
      <div className="dialog">
        <h2>Name Volume</h2>
        <form onSubmit={handleSubmit}>
          <div className="dialog-field">
            <label htmlFor="volume-name">Volume Name</label>
            <input
              id="volume-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Hallway, Office A, Kitchen..."
              autoFocus
            />
          </div>

          {existingVolumes.length > 0 && (
            <div className="dialog-field">
              <label>Connects To</label>
              <div className="connection-list">
                {existingVolumes.map((vol) => (
                  <label key={vol.id} className="connection-item">
                    <input
                      type="checkbox"
                      checked={selectedConnections.includes(vol.id)}
                      onChange={() => handleToggleConnection(vol.id)}
                    />
                    <span>{vol.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
              Confirm
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
