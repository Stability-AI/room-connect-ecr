# POR: Render Features and Bug Fixes

## Features

### 1. Load Camera Data JSON

Load a previously exported `camera_data.json` to recreate cameras in the scene.

- Add "Load Cameras" button in the Rendering tab (Camera Placement section)
- Parse the JSON (intrinsics + extrinsics format) and create camera entries
- Each loaded camera appears in the camera list with frustum visualization
- Allows resuming a session with previously placed/exported cameras

### 2. Area Light at View

Add an area light at the current camera view with adjustable brightness.

- New button "Add Light at View" in the Rendering tab
- Creates a rectangular area light facing the same direction as the current camera
- Adjustable brightness slider per light
- Lights shown in the frontend as a translucent rectangle gizmo in 3D
- Added lights included in the Blender scene when rendering via BPY
- Light data (position, rotation, size, intensity) sent alongside camera data in the render request

### 3. Render at Selected Camera

Render a single frame from the currently selected camera only.

- New button "Render Selected" appears when a camera is selected
- Renders only from that one camera (faster than rendering all)
- Allows downloading the single frame result directly (no ZIP needed)
- Uses the same render settings (samples, override lighting, FOV, depth maps)

---

## Bug Fixes

### 4. Deleted Cameras Still Rendered

When a camera is removed from the list, it should no longer be sent to the backend for rendering.

- **Root cause**: The render request sends the `cameras` array, which should reflect the current state. Verify that `cameras` state is correctly filtered after deletion before the render is triggered.
- **Fix**: Ensure `handleDeleteCamera` removes from state immediately and the render request always reads from current state.

### 5. Loaded OOBBs Displayed as Axis-Aligned

OOBBs loaded from `detected_objects.json` in the Rendering tab are displayed as axis-aligned boxes instead of respecting the OOBB rotation.

- **Root cause**: When normalizing loaded objects in `handleLoadObjects`, the quaternion is set to `[0, 0, 0, 1]` (identity) because the export format uses a 3x3 rotation matrix instead of a quaternion. The `OOBBOverlay` component needs the quaternion to orient the box correctly.
- **Fix**: Convert the 3x3 rotation matrix from the exported JSON into a quaternion during normalization. Use `THREE.Matrix4.makeBasis()` + `Quaternion.setFromRotationMatrix()`.
