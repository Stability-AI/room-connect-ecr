# Scene Connect — User Guide

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

## Tab 1: Scene

Scene-level tools for export and analysis — see [Scene Export & Analysis](#scene-export--analysis) below for full details.

---

## Tab 2: Connectivity

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

## Tab 3: Annotations

Object detection, annotation, connections, and multi-view rendering.

### Detecting Objects

1. Enter comma-separated filter terms (e.g. `chair, desk, furniture`)
2. Choose **Exclude mode** to match everything except the terms
3. Click **Detect** — orange OOBB wireframes appear around matching meshes
4. Use **Cull** / **Merge** to clean up overlapping boxes
5. Use **Show/Hide OOBBs** to toggle visibility

You can run detection multiple times with different terms — each new detection appends to the existing list (duplicates are automatically filtered out).

### Manual Annotation

1. **Double-click** any mesh in the 3D viewport to pick it
2. The picked mesh highlights orange and its name appears in the panel
3. Optionally type a new name in the **Rename** field
4. Click **Add to Pool** (or "Add as [name]" if renamed)
5. The object appears in the Object Pool with its OOBB

### Object Pool

Select an object in the pool to:
- **Rename** it (updates scene graph, connections, and annotations)
- **Add a description** (free text, included in exports)
- **Connect to** another object with a relationship type
- **Render Multi-View** for that object
- **Remove** it (× button)

### Creating Connections

1. Select an object → click **Connect To...**
2. Choose a relationship type from the dropdown:
   - Adjacent to, On top of, Inside of, Part of, Supports, Supported by
3. Click **Connect Here** on the target object
4. Red connection lines appear in the 3D viewport
5. Some relationships auto-create their inverse (e.g., "on top of" → "supported by")

### Multi-View Object Rendering

Renders each object in isolation from multiple viewpoints for 3D reconstruction:

1. Configure: Views (4-32), Resolution (128-2048), Samples, optional depth maps
2. **Background color**: click the color swatch to choose (default white)
3. **Transparent background**: check to render RGBA PNGs with alpha transparency
4. Click **Render Multi-View** on a single object, or **Render All Objects** for batch
5. Download ZIP with per-object renders + metadata

Multi-view renders use a controlled studio environment (single shadowless sun, no scene lights, no backdrop) independent of the Rendering tab settings.

### Export

Click **Export Annotations (JSON)** to download all objects with descriptions, OOBBs, and connections.

---

## Tab 4: Rendering

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
| Color management | **Standard** (accurate colors, default) or **Filmic** (compressed highlights — recommended with HDR backdrops and glass) |

> **Tip**: All slider values throughout the app support **double-click to edit** — type an exact number instead of dragging.

### Backdrop Image (World Environment)

Upload an equirectangular panorama to use as the scene's sky and optionally for image-based lighting (IBL):

1. Scroll to **Backdrop Image** in the Rendering tab
2. Drop or browse for a PNG, EXR, or HDR file
3. The image appears as a skybox in the 3D viewport preview
4. Configure:
   - **Show in viewport preview** — toggle the Three.js skybox
   - **Use for lighting (IBL)** — the image contributes to scene lighting via environment map
   - **Strength** — controls the Blender Background node intensity (affects render brightness)
   - **Exposure** — controls the viewport preview tone mapping exposure
5. To remove, click the **×** button — reverts to the default dark background

**Format notes:**
- **PNG**: Standard 8-bit, suitable for stylized backgrounds
- **EXR**: 16/32-bit HDR, provides realistic lighting and high dynamic range
- **HDR**: Radiance RGBE format, widely used for IBL panoramas

**Color management tip:** If the HDR sky appears blown out through glass/windows, switch color management to **Filmic** — it compresses highlights so bright areas remain visible instead of clipping to white.

The backdrop affects all render modes (Render Views, Splat Dataset, Flythrough) but does **not** affect Multiview Object Rendering, which uses its own isolated studio environment.

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

## Camera Flythrough Rendering

Create animated camera paths through your scene with smooth interpolation between placed cameras.

### Setup

1. Place at least 2 cameras in the scene (manually or via auto-placement)
2. Scroll to the **Flythrough** section in the Rendering tab

### Configuration

| Setting | Default | Range | Notes |
|---------|---------|-------|-------|
| Frames | 300 | 30-3000 | Total frames in the animation |
| FPS | 30 | 10-120 | Playback framerate |
| Format | PNG | PNG/EXR | EXR for HDR workflows |
| Depth maps | Off | On/Off | Separate depth renders per frame |

The calculated duration is shown automatically (frames ÷ FPS).

### How It Works

The camera follows a smooth path through all placed cameras in order:
- **Position**: linear interpolation (lerp) between consecutive waypoints
- **Rotation**: spherical linear interpolation (slerp) for smooth orientation transitions
- Frames are distributed evenly across all segments

### Render Quality

Flythrough uses animation-optimized Cycles settings:
- Compositor-based denoise (using Normal + Albedo passes for temporal stability)
- Path guiding with deterministic guiding for consistent indirect lighting
- Fixed random seed per frame to reduce flicker
- Deep light bounces (12 max, 8 glossy, 4 diffuse, 8 transmission)
- Tight adaptive sampling (0.005 noise threshold)

### Output

The flythrough is packaged as a ZIP containing:
- `frames/frame_0001.png` (or `.exr`) — rendered frames
- `frames/depth_0001.png` — depth maps (if enabled)
- `camera_data.json` — per-frame camera metadata with K matrix, intrinsics, and extrinsics

---

## Scene Export & Analysis

Scene-level tools for export and analysis.

### Export Complete Blender Scene

Exports the loaded GLB as a `.blend` file with all Scene Connect state included:

1. Select what to include via checkboxes:
   - **Cameras**: All placed cameras as Blender Camera objects
   - **User lights**: All placed lights as Blender Light objects
   - **Override lighting**: Studio lighting setup (if enabled)
   - **Render settings**: Resolution, samples
2. Click **Export Complete Blender Scene**
3. Download the ZIP containing the `.blend` file

The `.blend` can be opened in Blender with all cameras and lights in place, ready for further editing or rendering.

### Scene Analysis

Analyzes the loaded GLB for mesh quality, materials, and geometry:

1. Click **Analyze Scene** (may take 10-30 seconds for large scenes)
2. Results show:
   - Object counts (meshes, lights)
   - Total vertices and faces
   - Material analysis: how many use Principled BSDF, which PBR texture types are connected (albedo, roughness, metallic, normal, emission, etc.)
   - UV map presence
   - Watertight mesh count
   - Meshes with intersecting faces
   - Scene bounding box dimensions
3. Click **Download Full Report (JSON)** for the complete per-mesh breakdown

Enable **Show console** at the bottom to see operation progress.

### Point Cloud Generation

Generate a curvature-weighted point cloud for 3D Gaussian Splatting initialization. Edges and geometric detail get dense coverage; flat surfaces (walls, floors) stay covered enough to avoid holes.

#### Quick Start
1. Select a **Preset**: Fast (250k), Standard (750k), or Dense (1.5M)
2. Click **Generate Point Cloud**
3. Download the ZIP containing the PLY file

#### Advanced Settings

Expand "Advanced Settings" to configure:

| Parameter | Default | Description |
|-----------|---------|-------------|
| Target Points | 750,000 | Total point budget distributed by curvature-weighted area |
| Min Density Ratio | 0.12 | Floor density for flat faces (12% of max-curvature density) |
| Curvature Gamma | 0.5 | Power curve on curvature. <1 = spreads low-curvature range (recommended) |
| Percentile Clip | 0.95 | Clips sharpest 5% of edges before normalization |
| Seed | 42 | Random seed for reproducibility. Check "Random" for non-deterministic |
| Sample Colors | On | Bake scene material colours (sRGB) per point |
| Sample Normals | On | Include interpolated vertex normals |
| Coordinate System | COLMAP | COLMAP (Y-down, for Nerfstudio) or Blender (Z-up) |

#### Output

The PLY file contains per-point: position (x,y,z), optional normals (nx,ny,nz), RGB colour (scene or curvature greyscale), and a `curvature` float property.

#### Point Cloud Statistics

After generating a point cloud, click **Generate Point Cloud Stats** to verify the curvature–density correlation:

- **Pearson r**: Correlation between curvature and local point density (>0.3 = good, >0.5 = strong)
- **Linear fit**: Slope and intercept of the curvature → density regression
- **Quartile table**: Mean density for each curvature quartile, showing density increases with curvature
- Download the full stats as JSON

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
