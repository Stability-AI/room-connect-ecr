import React, { useState, useRef, useCallback } from "react";

export default function EditableValue({ value, onChange, min, max, defaultValue, format, style }) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const inputRef = useRef(null);

  const formatted = format ? format(value) : String(value);

  const startEdit = useCallback(() => {
    setEditText(String(value));
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [value]);

  const commit = useCallback(() => {
    setEditing(false);
    const parsed = parseFloat(editText);
    if (isNaN(parsed)) {
      onChange(defaultValue ?? value);
      return;
    }
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, parsed));
    onChange(clamped);
  }, [editText, onChange, min, max, defaultValue, value]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === "Enter") commit();
    if (e.key === "Escape") setEditing(false);
  }, [commit]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="editable-value-input"
        type="text"
        value={editText}
        onChange={(e) => setEditText(e.target.value)}
        onBlur={commit}
        onKeyDown={handleKeyDown}
        style={style}
      />
    );
  }

  return (
    <span
      className="param-value editable-value"
      onDoubleClick={startEdit}
      title="Double-click to edit"
      style={style}
    >
      {formatted}
    </span>
  );
}
