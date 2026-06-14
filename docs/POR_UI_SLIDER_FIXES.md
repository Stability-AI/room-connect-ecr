# POR: UI Slider Fixes

## 1. Double-Click to Edit Slider Values Manually

### Description
All slider values in the application should allow the user to double-click on the displayed number to enter a value manually via a text input. If the entered value is invalid (out of range, non-numeric, or empty), revert to the default value for that parameter.

### Affected Sliders
- Light Power (100–1,000,000)
- Light Exposure (0–1)
- Light Angle (10–170)
- Override Lighting Brightness (0.5–4.0)
- Override FOV (20–120)
- Cull Sensitivity (0–1)
- Merge Sensitivity (0–1)
- Eye Height (0.1–0.8)
- Min Wall Distance (0.005–0.1)
- Min Camera Spacing (0.01–0.15)

### Implementation
- Wrap each slider's value display `<span>` with a component that:
  - Shows the value as text by default
  - On double-click, replaces with an `<input type="text">` pre-filled with current value
  - On Enter or blur: validate input, apply if valid, revert to default if invalid
  - On Escape: cancel edit, keep current value
- Create a reusable `EditableValue` component:
  ```jsx
  <EditableValue
    value={currentValue}
    onChange={setValue}
    min={0}
    max={1}
    defaultValue={0.5}
    format={(v) => v.toFixed(2)}
  />
  ```

### Validation Rules
- Must be a valid number (parseFloat succeeds)
- Must be within min/max range
- If invalid: revert to `defaultValue` for that parameter

---

## 2. Light Exposure Range Fix

### Description
The exposure slider for lights should have a value range of 0 to 1 (not 0 to 10 as originally specified). This has already been partially implemented but needs to be confirmed across all code paths.

### Current State
- Frontend slider: min=0, max=1, step=0.01 (already fixed)
- Backend: `exposure = min(light_data.get("exposure", 0), 10.0)` — should cap at 1.0
- Default value for new lights: currently 5.0 — should be 0.0

### Fixes Needed
- Backend cap: change from `min(..., 10.0)` to `min(..., 1.0)`
- Default exposure for new lights in App.jsx: change from `exposure: 5.0` to `exposure: 0`
