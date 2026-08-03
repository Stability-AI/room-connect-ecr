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
4. A **progress bar** appears below the toolbar showing backend upload progress — the Render button activates once upload completes

### Replacing a Scene (Hot-Swap)

If a scene is already loaded and you click **Load Scene** again:
1. A dialog appears: "Update Scene?"
2. Choose what to do with existing data:
   - **Keep All** — preserves volumes, detected objects, cameras, lights, and render settings
   - **Clear Detection Data** — clears detected objects, keeps volumes/cameras/lights
   - **Clear Everything** — fresh start (only cameras, lights, and render settings are preserved)
3. The old scene's 3D data is properly disposed to free memory

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
- **Cull Selection**: Remove smaller boxes nested inside larger ones (adjustable sensitivity slider). Only affects the latest detection batch — previously committed objects are protected.
- **Merge Selection**: Absorb smaller overlapping OOBBs into the larger enclosing one, expanding it to cover the union of both volumes. Uses the same sensitivity slider and batch protection as cull.
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

### Scene Lights

Add custom lights for rendering:
1. Click **Add Spot Light** or **Add Area Light** — placed at your current view position
2. Adjust parameters using sliders or **double-click any value to type an exact number**
3. **Click a light** in the list or in the 3D viewport to select it (highlights orange in 3D, green in list)
4. Delete individual lights or save/load light configurations as JSON

### Render Settings
| Setting | Description |
|---------|-------------|
| Width / Height | Output resolution in pixels (frustum shapes update to match) |
| Samples | Cycles render quality (higher = better, slower) |
| Override FOV | Custom field of view (20°–120°) with live preview in the viewport |
| Generate depthmaps | Also render 32-bit EXR depth maps (fast: 1-sample Cycles) |
| Override lighting | Replace scene lights with even studio illumination |
| Brightness slider | Adjust override lighting intensity (0.5x–4.0x) |
| Include .blend file | Add the Blender scene to the ZIP, including all placed cameras and lights |
| Export camera intrinsics/extrinsics | Download camera parameters as JSON |
| Show debug console | Display real-time Blender render logs |

> **Tip**: All slider values throughout the app support **double-click to edit** — type an exact number instead of dragging.

### Rendering
1. Click **Render Views (N)** where N is the number of placed cameras
2. A barber-pole animation shows rendering is in progress
3. If debug console is enabled, Blender logs stream in real-time
4. When complete, click **Download All (ZIP)**

### Output Files
The ZIP contains:
- `render_CameraName_id.png` — Color render for each camera
- `depth_CameraName_id.exr` — Depth map (if enabled)
- `scene_id.blend` — Blender scene file with all cameras and lights (if enabled)

---

## Gaussian Splatting Dataset Generation

Generate a Nerfstudio-compatible training dataset for 3D Gaussian Splatting reconstruction.

### Setup
1. Load a GLB scene and ensure it has adequate lighting (add lights or enable "Override lighting")
2. Scroll to **Gaussian Splat Dataset** section on the Rendering tab
3. Set **Views** (80-400, default 200) and **Preset** (Fast/Balanced/Hero)
4. Optionally check **Include depth maps** for depth-supervised training
5. Optionally check **Render as HDR (OpenEXR)** for HDR-aware splat methods:
   - Select bit depth: 16-bit half (recommended) or 32-bit float
   - **Apply log(1+x) transform** is recommended -- compresses dynamic range for stable training (invertible via `exp(y) - 1`)
   - Note: standard splatfacto expects PNG; HDR EXR is for HDR-aware methods only

### Generating
1. Click **Generate Splat Dataset**
2. If no lights are present, a warning dialog appears — add lights or enable override lighting first
3. Choose from:
   - **Preview Cameras Only** — places cameras in the scene for visual inspection without rendering. You can then select, delete, or adjust individual cameras before committing.
   - **Render Current Cameras** — renders whatever cameras are already in the camera pool at the selected quality preset
   - **New Cameras + Render** — auto-places the specified number of cameras then immediately starts rendering

### Camera Distribution
Cameras are placed at 3 height layers optimized for 3DGS reconstruction:
- **Low** (~15% of room height): captures floor details and object bases
- **Mid** (~40%): standing eye-level, primary coverage
- **High** (~75%): object tops, ceiling detail, downward angles

Orientations are randomized (360° yaw, height-dependent pitch) for diverse angular coverage across all surfaces.

### Analyzing Camera Distribution

After placing cameras (via "Preview Cameras Only" or any other method), click **Analyze Distribution** to evaluate coverage quality:

- **Quality Score (0-100)**: Combined metric weighting spatial uniformity (30%), ray hit rate (50%), and angular diversity (20%)
- **Spatial CV**: Coefficient of variation of local density. < 0.3 = well distributed (green), 0.3-0.7 = moderate clustering (yellow), > 0.7 = significant gaps (red)
- **Angular divergence**: Mean angle between neighboring cameras' view directions. Higher = more diverse. Splat mode typically achieves 60-90°
- **Ray hits**: % of frustum rays that hit scene geometry (should be 80%+ for interiors)
- **Multi-view**: % of observed faces seen by 3+ cameras (important for 3DGS reconstruction)

Colored spheres appear at each camera position: green = well-positioned, yellow = slightly sparse, red = coverage gap, blue = clustered. A surface heatmap overlay shows which parts of the scene are well-observed (green) vs under-observed (red).

### Quality Presets

| Preset | Resolution | Samples | Est. time (CPU, 200 views) |
|--------|-----------|---------|---------------------------|
| Draft | 2560×1440 | 32 | ~20-40 min |
| Fast | 1920×1080 | 256 | ~3-6 hours |
| Balanced | 2560×1440 | 512 | ~8-16 hours |
| Hero | 3840×2160 | 1024 | ~24-48 hours |

### Output
The downloaded ZIP contains:
```
splat_dataset/
├── transforms.json     # Nerfstudio camera poses (OPENCV model) + intrinsics + aabb_scale
├── images/
│   ├── 0000.png        # or 0000.exr if HDR enabled
│   ├── 0001.png
│   └── ...
└── depth/              # if depth maps enabled
    └── ...
```

The `transforms.json` includes `camera_angle_x/y` (FOV in radians), `aabb_scale` (scene geometry extent), and per-frame 4x4 transform matrices.

Use with Nerfstudio:
```bash
ns-train splatfacto --data ./splat_dataset
```

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

- For large scenes (500MB+), the initial load may take 10–20 seconds. The upload to backend happens in parallel with 4x concurrent chunks — watch the progress bar below the toolbar.
- Use **Diffuse** mode for fastest navigation on complex scenes.
- Auto-placed cameras work best after detecting objects (enables entropy-based orientation).
- The **Relaxed** preset generates more cameras with tighter tolerances; **Dense** minimizes spacing for maximum coverage.
- Render with low samples (32–64) for quick previews, higher (256–512) for final quality.
