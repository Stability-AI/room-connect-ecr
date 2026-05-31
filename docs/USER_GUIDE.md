# Room Connect — User Guide

## Getting Started

### Prerequisites
- Docker and Docker Compose installed
- A 3D scene in `.glb` format (GLTF binary)

### Launch
```bash
docker-compose up --build
```
Open **http://localhost:3000** in your browser.

---

## Loading a Scene

1. Click **Load Scene (.glb)** in the toolbar
2. Select your GLB file (supports files up to 700MB+)
3. The scene loads in the 3D viewport and simultaneously uploads to the backend for rendering

### Navigation Controls
- **Left-click + drag**: Orbit
- **Right-click + drag**: Pan
- **Scroll**: Zoom
- **Ortho button**: Toggle orthographic/perspective projection

### Shading Modes
Use the toolbar buttons to switch between:
| Mode | Description |
|------|-------------|
| Normals | World-space surface normals (RGB) |
| Wireframe | Front-face wireframe (fast for large scenes) |
| Diffuse | Grey non-textured with studio lighting |
| Texture | Unlit albedo maps only |
| Shaded | Full PBR textures + studio lighting |

---

## Tab 1: Volume Connectivity

Define walkable areas and their connections.

### Drawing Volumes
1. Click **Draw Volume**
2. Click and drag on the ground plane to create a bounding box
3. Use colored handles to adjust:
   - **Red** (cube): Scale X axis
   - **Green** (cube): Scale Y axis
   - **Blue** (cube): Scale Z axis
   - **Red** (sphere): Translate X
   - **Green** (sphere): Translate Y
   - **Blue** (sphere): Translate Z
4. Press **Enter** to confirm
5. Name the volume and select which other volumes it connects to

### Editing Volumes
- **Double-click** a volume to re-enter edit mode
- Press **Enter** to confirm, **Escape** to cancel

### Export
Click **Export Graph (JSON)** to download the connectivity graph containing all volumes, their UIDs, names, centers, sizes, and connection relationships.

---

## Tab 2: Object Detection

Filter and detect objects in the scene by name, compute bounding boxes.

### Detecting Objects
1. Enter comma-separated filter terms (e.g. `chair, desk, furniture`)
2. Choose **Include** (match) or **Exclude** (match everything else)
3. Click **Detect Objects**
4. Orange OOBB wireframes appear around matching meshes

You can run detection multiple times with different terms — each new detection appends to the existing list (duplicates are automatically filtered out). This allows you to build up a complete object set incrementally (e.g. detect "chair" first, then "desk", then "monitor").

### Managing Results
- **Show/Hide OOBBs**: Toggle visibility
- **Cull Selection**: Remove smaller boxes nested inside larger ones (adjustable sensitivity slider). Only affects the latest detection batch — previously committed objects are protected from culling.
- **Clear OOBBs**: Remove ALL detections and reset the list
- **Export Objects (JSON)**: Download OOBB data for the full accumulated list (center, half-extents, rotation matrix, world position)

---

## Tab 3: Rendering

Place cameras and render high-quality views via Blender Cycles.

### Placing Cameras

**Manual (Place at View)**:
1. Navigate to the desired viewpoint using orbit controls
2. Click **Place at View** — a camera frustum appears at that position

**Automatic (Auto-Place)**:
1. Set the number of cameras to generate
2. Optionally check **Maximize Viewpoint Entropy** — orients cameras toward detected objects:
   - If objects were detected in the current session, they are used automatically
   - Otherwise, load a `detected_objects.json` file from a previous session
3. Optionally check **Constrain to Volume** — limits camera placement to a specific room/zone:
   - If volumes were drawn in the current session, they are available automatically
   - Otherwise, load a `connectivity_graph.json` file and select a volume from the dropdown
4. Optionally expand **Advanced Settings** to adjust placement parameters (eye height, wall distance, spacing) or apply presets (Relaxed/Conservative/Dense)
5. Click **Auto-Place Cameras**

When constraint/entropy options are enabled, the corresponding volumes and OOBBs are visualized in the 3D viewport.

### Managing Cameras
- **Click** a camera in the list to select it
- **Double-click** or **Align Viewpoint** to switch your view to that camera
- **Realign to View**: Update the selected camera to your current free-view
- **Clear All**: Remove all placed cameras
- Camera frustum shapes reflect the configured render width/height

### Render Settings
| Setting | Description |
|---------|-------------|
| Width / Height | Output resolution in pixels |
| Samples | Cycles render quality (higher = better, slower) |
| Generate depthmaps | Also render 32-bit EXR depth maps |
| Override lighting | Replace scene lights with even studio illumination |
| Brightness slider | Adjust override lighting intensity (0.5x–4.0x) |
| Include .blend file | Add the Blender scene to the ZIP for inspection |
| Export camera intrinsics/extrinsics | Download camera parameters as JSON |
| Show debug console | Display real-time Blender render logs |

### Rendering
1. Click **Render Views (N)** where N is the number of placed cameras
2. A barber-pole animation shows rendering is in progress
3. If debug console is enabled, Blender logs stream in real-time
4. When complete, click **Download All (ZIP)**

### Output Files
The ZIP contains:
- `render_CameraName_id.png` — Color render for each camera
- `depth_CameraName_id.exr` — Depth map (if enabled)
- `scene_id.blend` — Blender scene file (if enabled)

---

## Keyboard Shortcuts

| Key | Context | Action |
|-----|---------|--------|
| Enter | Drawing/editing volume | Confirm volume |
| Escape | Drawing/editing volume | Cancel |
| Enter | Editing existing volume | Confirm changes |
| Escape | Editing existing volume | Revert changes |

---

## Tips

- For large scenes (500MB+), the initial load may take 10–20 seconds. The upload to backend happens in parallel.
- Use **Diffuse** mode for fastest navigation on complex scenes.
- Auto-placed cameras work best after detecting objects (enables entropy-based orientation).
- The **Relaxed** preset generates more cameras with tighter tolerances; **Dense** minimizes spacing for maximum coverage.
- Render with low samples (32–64) for quick previews, higher (256–512) for final quality.
