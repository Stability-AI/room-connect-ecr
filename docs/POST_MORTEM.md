# Room Connect — Post-Mortem Documentation

## What Was Built

Room Connect is an interactive web-based 3D application for interior scene analysis. It allows users to load large GLTF/GLB 3D scenes, define walkable area volumes with connectivity graphs, detect and label objects, place cameras (manually or automatically), and render high-quality views via Blender Cycles — all orchestrated through a Docker-based architecture.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React + Three.js via React Three Fiber)       │
│  Port 3000 | Vite dev server                            │
│                                                          │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │Connectivity│  │Object Detect.│  │   Rendering      │  │
│  │Tab         │  │Tab           │  │   Tab            │  │
│  └──────────┘  └──────────────┘  └──────────────────┘  │
│              Shared 3D Canvas (SceneViewer)              │
└────────────────────────┬────────────────────────────────┘
                         │ /api/* (Vite proxy → backend:5000)
┌────────────────────────┴────────────────────────────────┐
│  Backend (Python Flask + Blender BPY)                    │
│  Port 5000 | Gunicorn (gthread, 600s timeout)           │
│                                                          │
│  ┌───────────────┐  ┌────────────────────────────────┐  │
│  │ File Upload    │  │ Cycles Renderer                │  │
│  │ (chunked 10MB) │  │ (multi-camera, material repair)│  │
│  └───────────────┘  └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
                    Docker Compose
```

---

## Phase 1: Core Application

### What was done
- Replaced the original Python placeholder package with a full web application
- React + Three.js frontend, Flask backend, Docker orchestration

### Volume Connectivity (Tab 1)
- User loads a GLB scene (loaded client-side via blob URL — handles 700MB+ files)
- Draw axis-aligned bounding box volumes by clicking and dragging on the ground plane
- Scale/translate volumes using colored handles (R=X, G=Y, B=Z)
- Name volumes and define connectivity relationships via dialog
- Double-click to re-edit existing volumes
- Export connectivity graph as JSON (UIDs, names, centers, connections)

### Scene Visualization
- 5 shading modes: Normals (world-space), Wireframe (backface culled), Diffuse (grey + studio lighting), Texture (unlit albedo), Shaded (PBR + studio lighting +15%)
- Orthographic/perspective toggle
- Logarithmic depth buffer (prevents z-fighting on large scenes)
- GLB lights hidden in real-time preview; studio lighting (ambient + hemisphere + 3 directional) always used for Diffuse/Shaded modes
- Brightness controllable via slider (mirrored between frontend preview and backend renders)

---

## Phase 2: Object Detection

### What was done
- Case-insensitive substring matching against mesh names in the GLTF scene graph
- Include/exclude filtering modes
- World-space OOBB computation (position, rotation, scale from mesh world matrix)
- Orange wireframe overlay boxes in 3D view
- Cull Selection with adjustable sensitivity slider (removes smaller OOBBs inside larger ones)
- Export detected objects as JSON

### Key decisions
- All computation runs client-side (no backend needed)
- Simple string matching chosen over regex for usability
- Incremental detection: multiple runs accumulate results (deduplicated by name + position)
- Cull only affects the latest batch — previously committed objects are protected
- Merge Selection: absorbs smaller overlapping OOBBs into the enclosing larger one, expanding it to cover the union (iterates until stable)
- Exported JSON can be re-loaded in the Rendering tab for entropy-based camera orientation

---

## Phase 3: Rendering Pipeline

### GLB Upload (Frontend → Backend)
- Decided to use chunked streaming upload
- Frontend slices file into 10MB chunks, sends sequentially via fetch
- Backend writes chunks to disk via `request.stream` (never buffers full file in RAM)
- Merge endpoint assembles final file
- Verified: 700MB GLB uploaded with zero data corruption (MD5 match confirmed)
- Gunicorn configured with 600s timeout + gthread workers

### Blender Cycles Rendering
- **Decision**: Use Blender BPY (scenes designed for Cycles)
- bpy 4.1+ installed in Docker (linux/amd64 platform for pip compatibility)
- Renders from ALL placed cameras (not just default scene camera)
- Color pass (PNG) + optional depth pass (32-bit EXR with normalize+invert compositor)
- Y-up (Three.js) → Z-up (Blender) coordinate conversion for camera poses
- Material repair: parses GLB JSON header, rebuilds Principled BSDF for materials with `baseColorTexture` (fixes broken importer connections); leaves glass/emissive materials untouched
- Override lighting: 6 scaled area lights + bright world environment (strength × brightness slider)
- Override FOV: custom field of view (20°–120°) with live scene camera preview; captured per camera and sent to Blender
- Output packaged as ZIP (optionally includes .blend file for inspection)
- SSE (Server-Sent Events) streams render logs to frontend debug console in real-time
- Non-convergence dialog: popup if auto-placement fails or partially converges with actionable suggestions

### Camera Placement — Manual
- "Place at View": captures current Three.js camera position + quaternion
- Frustum visualization: pyramid geometry with aspect ratio matching render dimensions
- Double-click or "Align Viewpoint" to switch scene camera to that view
- "Realign to View" updates selected camera to current free-view
- Camera intrinsics/extrinsics exportable as JSON

### Camera Placement — Automatic
- Uses `three-mesh-bvh` for O(log n) proximity queries (runs entirely in frontend)
- Merges all scene mesh geometries (position-only, strips UVs for compatibility)
- Detects floor level (5th percentile of Y vertices)
- Samples random positions within scene bounds at relative eye height
- Validates: inside mesh (raycast up + down), minimum distance from surfaces, minimum spacing between cameras
- Orientation: looks toward scene center at waist height; with "Maximize Viewpoint Entropy" enabled, orients toward the cluster of detected OOBB centers maximizing objects in FOV
- Advanced parameters: eye height ratio, min wall distance, min spacing (with Relaxed/Conservative/Dense presets)
- **Constrain to Volume**: load a `connectivity_graph.json` or use session volumes to restrict camera sampling to a specific room/zone bounding box
- **Session continuity**: volumes from Connectivity tab and objects from Detection tab are automatically available in Rendering tab without needing to re-export and re-load JSON files
- Loaded volumes visualized as translucent blue AABBs (selected = green); loaded objects as orange OOBB wireframes

### Key Technical Challenge: Frustum Alignment
- Quaternions computed outside R3F render loop produced "flipped" orientations
- Solution: sequentially move the actual scene camera to each generated position, call `lookAt`, wait one render frame (100ms), then capture the quaternion — identical to "Place at View"
- This ensures OrbitControls processes the rotation through a full render cycle

---

## How to Run

### Development (Docker Compose)
```bash
docker-compose up --build
```
- Frontend: http://localhost:3000
- Backend: http://localhost:5000

### Production
```bash
docker build -t room-connect .
docker run -p 8080:8080 room-connect
```

---

## Usage Workflow

1. **Load Scene** — Click "Load Scene (.glb)", select file. Three.js loads via blob URL; simultaneously uploads to backend via chunked streaming.

2. **Explore** — Orbit, pan, zoom. Switch shading modes (Normals/Wireframe/Diffuse/Texture/Shaded). Toggle orthographic.

3. **Define Volumes** (Connectivity tab) — Click "Draw Volume", drag on ground plane, use handles to adjust, press Enter, name it and set connections. Export graph as JSON.

4. **Detect Objects** (Object Detection tab) — Enter filter terms (comma-separated), choose Include/Exclude, click "Detect Objects". Toggle/cull OOBBs. Export as JSON.

5. **Place Cameras** (Rendering tab) — Navigate to desired view and click "Place at View", OR click "Auto-Place Cameras" for algorithmic placement. Adjust advanced settings as needed.

6. **Render** — Configure width/height/samples, check "Generate depthmaps" and/or "Override lighting" as needed. Click "Render Views". Monitor progress via debug console. Download ZIP when complete.

---

## File Structure

| File | Purpose |
|------|---------|
| `backend/app.py` | Flask routes: chunked upload, SSE render, file serving |
| `backend/rendering/cycles_renderer.py` | Blender Cycles: scene load, material repair, lighting, multi-camera render |
| `frontend/src/App.jsx` | Root state management, camera placement logic |
| `frontend/src/components/SceneViewer.jsx` | Three.js canvas, shading modes, camera controller |
| `frontend/src/components/RenderingPanel.jsx` | Camera list, render settings, SSE log console |
| `frontend/src/components/CameraFrustum.jsx` | 3D camera pyramid visualization |
| `frontend/src/components/ObjectDetectionPanel.jsx` | Object filter UI, cull dialog |
| `frontend/src/components/OOBBOverlay.jsx` | 3D OOBB wireframe boxes |
| `frontend/src/components/DrawingVolume.jsx` | Volume creation with handles |
| `frontend/src/utils/cameraPlacement.js` | BVH-based auto camera placement algorithm |
| `frontend/src/utils/objectDetection.js` | OOBB computation + culling logic |
| `frontend/src/utils/sceneUpload.js` | Chunked file upload utility |

---

## Phase 4: ECR and Kubernetes Deployment

### What was done
- Deployed Room Connect as a live service on `data1-us-west-2` EKS cluster (Stability AI Data Account `009160059619`)
- Followed company standard practices: terraform-infra for ECR/IRSA, kubernetes-data for ArgoCD GitOps, Karpenter for node scheduling

### Infrastructure (terraform-infra #1112)
- ECR repository `stability/room-connect-ecr` created via `gha_deployable_repos` list (auto-creates repo + lifecycle policy + OIDC trust)
- IRSA role `data1-us-west-2-room-connect-irsa` scoped to `data-room-connect` namespace
- Fixed pre-existing OIDC security issue: `GitHubOIDCRole` sub-claims used `:*` wildcards; pinned to `:ref:refs/heads/main` + `:pull_request` for all repos

### Kubernetes (kubernetes-data #39, #40, #41)
- Pattern A deployment (Kustomize + ALB Ingress) in namespace `data-room-connect`
- Initially deployed on `data-gpu-g6g7` Karpenter pool; switched to `data-cpu-realtime` after GPU cold-start scheduling issues (5-10 min node provision delays)
- Blender Cycles falls back to CPU rendering automatically — functional but slower
- ALB Ingress at `room-connect.data.stability.ai`
- ServiceAccount with IRSA annotation

### CI/CD Pipeline
- GitHub Actions `on_merge.yaml`: semantic-release → Docker build → push to ECR (versioned tag + latest)
- GitHub Actions `on_pr.yaml`: pre-commit → Docker build → push dev image → PR comment
- Switched from self-hosted CodeBuild runners to `ubuntu-latest` (CodeBuild not configured for this repo)
- Image tag bumps in kubernetes-data trigger ArgoCD auto-sync (~3 min)

### Production Dockerfile updates
- Pinned platform to `linux/amd64` (bpy wheels are amd64-only)
- Added bpy system libraries (GL, EGL, X11) to production image
- Added Draco decompression library for compressed GLB support
- Added `--timeout 600` and `gthread` worker class to gunicorn

### Key decisions
- **CPU over GPU for initial deployment**: GPU Karpenter pool required cold-start provisioning (5-10 min) and hit scheduling issues with Cilium CNI initialization. CPU realtime pool has existing nodes (zero cold start). Renders are slower but the app is fully functional.
- **ArgoCD GitOps, not kubectl**: Manifests live in `kubernetes-data`, not the app repo. Rollbacks = revert a manifest commit.
- **Pinned image tags, not :latest**: Each release gets a semver tag (e.g., `0.2.0`). The kubernetes-data deployment references the specific tag.
- **No IRSA policies yet**: The app uses local disk for uploads (emptyDir volume). S3 storage can be added later via IRSA policy attachment.

---

## Phase 5: Upload Optimization

### What was done
- Replaced sequential chunk uploads with 4-worker parallel concurrency pool
- 700MB upload time reduced from ~12 minutes to ~3 minutes
- Added per-chunk retry with exponential backoff (3 attempts)
- Added full-width upload progress bar below the toolbar, visible across all tabs
- Added upload status message on Rendering tab explaining why the Render button is disabled during upload
- Added error message if backend upload fails

### Key decisions
- **4 concurrent workers**: Enough to saturate the network without overwhelming the single gunicorn gthread worker. Backend handles concurrent chunk writes safely (each chunk has its own file path).
- **Progress bar placement**: Below the toolbar (not inside a tab panel) so it's visible regardless of which tab the user is on.
- **Retry logic**: Transient network failures on K8s (ALB timeouts, pod restarts) are recoverable with per-chunk retry.

---

## Phase 6: Depth Map Optimization

### What was done
- Reduced depth map render samples from 32 to 1 in `configure_depthmap_settings()`
- Depth maps only need geometry information (Z-pass), not light transport -- 1 sample is sufficient
- Kept Cycles engine instead of switching to EEVEE (avoids engine-switching complexity, same speed benefit)
- Added compositor null-safety and iterated all view layers for Z-pass enablement
- Compositor pipeline unchanged: Z-pass → Normalize → Invert → Composite → 32-bit EXR

### Key decision
- **Cycles at 1 sample vs EEVEE**: The POR originally proposed switching to EEVEE. In practice, Cycles at 1 sample achieves the same ~32x speedup without the risk of EEVEE Z-pass depth range differences or engine availability issues in the bpy Docker image. Single ray per pixel with no denoising is effectively equivalent to rasterized depth.

---

## Phase 7: Hot-Swap GLB

### What was done
- Loading a new GLB when a scene is already loaded now shows a confirmation dialog instead of silently clearing all state
- Three clear modes: "Keep All" (preserves volumes + detected objects), "Clear Detection Data" (clears objects, keeps volumes), "Clear Everything" (original behavior)
- Cameras, lights, render settings, and FOV are always preserved across scene swaps
- Added proper Three.js scene disposal on unmount: geometries, materials, and textures are disposed, `useGLTF` cache is cleared for the old URL
- `sceneRef` resets so object detection re-traverses the new scene graph

### Key decisions
- **Dialog over silent clear**: Users who spent time placing cameras and lights shouldn't lose that work when updating a scene revision. The dialog makes the tradeoff explicit.
- **Disposal via cleanup effect**: The `useEffect` return function on `SceneModel` runs when the URL changes (new scene) or on unmount, preventing memory leaks from accumulated geometries/textures on large scenes.

---

## Phase 8: UI Slider Fixes

### What was done
- Created reusable `EditableValue` component: double-click any slider value to type an exact number, validates against min/max, reverts to default if invalid, Enter/blur commits, Escape cancels
- Wired `EditableValue` to all 10 slider values: light power, exposure, angle, size X/Y, brightness, FOV, eye height, min wall distance, min spacing
- Added `selectedLightId` state with bidirectional selection: click a light in the 3D viewport or the list to select it
- Selected lights highlight orange (`#ff8800`) in the 3D view; unselected use default colors (yellow spot, cyan area)
- Invisible sphere click targets on spot light gizmos for easier picking
- Light list items highlight with `.selected` CSS class on click

### Key decisions
- **Orange highlight over white**: White selected lights are indistinguishable from diffuse-shaded surfaces. Orange stands out across all shading modes.
- **Reusable component over inline logic**: `EditableValue` handles all edit/validate/revert logic generically, keeping each slider callsite to a single JSX tag.

---

## Lessons Learned

1. **Large file handling**: Client-side blob URLs bypass upload limits for visualization; chunked streaming (10MB/chunk) solves backend transfer for 700MB+ files.

2. **Coordinate systems**: Three.js (Y-up) vs Blender (Z-up) requires position swap `(x, -z, y)` and quaternion rotation for camera poses.

3. **Material import fidelity**: Blender's glTF importer doesn't always connect textures correctly. Parsing the GLB JSON header and selectively rebuilding materials with `baseColorTexture` fixes this while preserving glass/emissive materials.

4. **React Three Fiber quaternions**: Computing quaternions outside the R3F render loop (via standalone PerspectiveCamera or Matrix4.lookAt) produces different results than the OrbitControls-managed camera. The solution: let the scene camera process each position through a full render frame before capturing.

5. **Override lighting for interiors**: Interior scenes with embedded lights render too dark without boost. A bright world environment (strength 15.0) + 6 scaled area lights from all directions provides even architectural illumination.

6. **BVH for spatial queries in browser**: `three-mesh-bvh` enables the same proximity testing as Trimesh/Blender BVHTree, running entirely client-side at interactive rates on tested 700MB GLB-imported scene.

7. **GPU cold starts on Karpenter**: GPU nodes (G5/G6/G7) take 5-10 minutes to provision from scratch. The Cilium CNI `agent-not-ready` taint adds additional delay. For proof-of-concept deployments, CPU realtime pools (already running shared nodes) provide instant scheduling.

8. **ECR repos via Terraform, not CLI**: The `DataEngineeringEKSAdmin` role intentionally lacks `ecr:CreateRepository`. All ECR repos are created via the `gha_deployable_repos` list in terraform-infra, which also wires up lifecycle policies and OIDC trust automatically.

9. **Self-hosted runners need repo configuration**: CodeBuild self-hosted runners from the sai-research-template don't automatically cover new repos. Switching to `ubuntu-latest` (GitHub-hosted) is the pragmatic fix when CodeBuild isn't configured.

10. **Silent upload failures degrade UX**: The upload progress state existed in `App.jsx` but was never rendered. Users saw a permanently disabled Render button with no explanation. Always surface background operation state in the UI.

---

## Phase 9: Gaussian Splatting Dataset Generation

### What was done
- Added "Generate Splat Dataset" section to the Rendering tab with view count slider (80-400, default 200) and quality preset selector (Draft/Fast/Balanced/Hero)
- Backend: `configure_splat_settings()` with 4 quality presets (Draft: 1440p/32 samples, Fast: 1080p/256, Balanced: 1440p/512, Hero: 4K/1024), deep light bounces (12 max, 8 diffuse), OpenImageDenoise, lossless PNG, neutral color management
- Backend: `render_splat_dataset()` renders all cameras and exports Nerfstudio-compatible `transforms.json` with per-frame 4x4 transform matrices and shared intrinsics
- Backend: `/api/render-splat-dataset` SSE endpoint with progress streaming
- Three-option confirmation dialog: "Preview Cameras Only" (places cameras for inspection), "Render Current Cameras" (renders existing camera pool), "New Cameras + Render" (auto-places then renders)
- No-lights warning dialog prevents wasting render time on unlit scenes
- Fixed SSE log duplication bug in the splat render stream parser

### Camera placement for 3DGS (splat mode)
- **3-layer height distribution**: low (2-18% of interior height, 20% of cameras), mid (30-50%, 50% of cameras), high (65-85%, 30% of cameras) -- based on research showing 3-height capture is optimal for Gaussian Splatting
- **Diverse orientations**: random yaw (0-360°) with height-dependent pitch (high cameras look down, low cameras look up, mid cameras look straight) instead of all cameras pointing at scene center
- **Interior AABB heuristic**: constraints (min wall distance, min spacing) scale from detected interior dimensions via ceiling raycast, not the full scene bounding box -- prevents constraint values being dominated by exterior geometry
- **Progressive relaxation**: if placement stalls, constraints auto-reduce over 5 passes to fill the available space
- **Auto-adjusted spacing**: `minSpacingRatio` and `minDistanceRatio` scale inversely with camera count for dense placement

### Key decisions
- **Client-side placement, not server-side**: The existing BVH-based algorithm in `cameraPlacement.js` handles 80-400 cameras with auto-adjusted spacing. No need to port to bpy -- the camera list (a few KB of JSON) is sent to the backend for rendering.
- **Nerfstudio format**: `transforms.json` uses shared top-level intrinsics (FOV is global), per-frame 4x4 `transform_matrix` in OpenGL convention (Blender's `matrix_world` directly), zero distortion coefficients (Blender = perfect pinhole camera).
- **Gunicorn timeout set to 24h in dev**: Long renders (80+ frames at 256+ samples) easily exceed 10-minute timeout. Production timeout stays at 600s but should be reviewed for splat workloads.
- **No EEVEE switch for depth**: Kept Cycles at 1 sample for depth maps -- same speed as EEVEE without engine-switching complexity.

---

## Phase 10: Transforms Format, HDR EXR, Log Transform, and .blend Camera Persistence

### What was done
- **Nerfstudio transforms.json format**: Changed `camera_model` from `PINHOLE` to `OPENCV` with zero distortion coefficients for standard Nerfstudio compatibility. Added `camera_angle_x/y` (FOV in radians), `aabb_scale` computed from scene geometry AABB (not camera positions). Frame naming changed to 0-indexed 4-digit (`0000.png`). JSON indented with 4 spaces.
- **HDR EXR output**: Added checkbox to render splat dataset frames as 16-bit half or 32-bit float OpenEXR instead of 8-bit PNG. EXR uses `Raw` view transform for linear radiance output; PNG uses `Standard` tone mapping. Tooltip warns that standard splatfacto expects PNG.
- **Log transform**: When HDR is enabled, optional `log(1+x)` post-processing compresses dynamic range for stable 3DGS training. Applied in-place to EXR frames after rendering using bpy's image API. Monotonic and invertible via `exp(y) - 1`. Default on when HDR is checked.
- **Persistent cameras in .blend**: When "Include .blend file" is checked, all user cameras are re-created as permanent Blender Camera objects (with proper Y-up to Z-up conversion) before saving. First camera set as active scene camera. User lights already persist naturally from `_add_user_lights()`.

### Key decisions
- **OPENCV over PINHOLE**: While PINHOLE is technically correct for Blender's distortion-free renders, OPENCV with zero distortion is the Nerfstudio standard and avoids compatibility issues with third-party tools.
- **Scene geometry AABB for aabb_scale**: Computing from all mesh bounding boxes gives the true scene extent, not just camera positions which may be a small subset of the scene volume.
- **bpy image API for log transform**: Avoided adding `OpenEXR` Python package as a dependency -- bpy already has EXR read/write capability via `bpy.data.images.load()` and `.save()`.
- **Camera persistence only in render_all_views**: Single-view render doesn't receive the camera list from the frontend; splat dataset doesn't have a .blend export option yet.

---

## Phase 11: Camera Distribution Analysis and Splat Orientation Fix

### What was done
- **Camera distribution analysis tool**: Frontend-only implementation using k-NN density estimation (spatial), pairwise angular diversity, and BVH frustum raycasting (surface coverage). Reports a combined 0-100 quality score.
- **"Analyze Distribution" button**: Available when 3+ cameras exist, runs all three analyses instantly (~0.1s for 300 cameras).
- **Colored spheres**: Camera positions colored by spatial density -- blue (clustered), green (well-covered), yellow (sparse), red (gap).
- **Surface heatmap overlay**: Scene geometry colored by observation count -- red (unobserved) through green (well-covered) to blue (heavily observed). Semi-transparent overlay toggled by running analysis.
- **Fixed splat-mode camera orientations**: Discovered that splat-mode diverse quaternions (computed in `cameraPlacement.js`) were being thrown away -- `handleAutoPlaceCameras` moved the scene camera to each position and let OrbitControls capture the quaternion, which always pointed at OrbitControls' target (scene center). Fix: splat-mode cameras now bypass OrbitControls entirely and use their pre-computed quaternions directly. Also makes placement instant (batch add) instead of 100ms per camera.
- **Fixed frustum raycasting**: Changed `faceCounts` from `Uint16Array` (max 65535) to `Uint32Array` for high-poly scenes (5M+ faces). Used ray hit rate instead of face coverage percentage as the metric (90K rays can't meaningfully cover 5M faces).
- **Render settings**: Added Draft preset (2560x1440, 32 samples). Applied flicker-stable render config (fixed seed, adaptive min samples 256, OIDN ACCURATE prefilter, indirect clamp 20, guiding disabled).

### Key decisions
- **Frontend-only, no scipy**: Used k-NN density estimation instead of Voronoi tessellation. No 3D Voronoi library exists in JS, and k-NN CV correlates strongly with Voronoi CV. BVH raycasting via `three-mesh-bvh` is faster than bpy.
- **Ray hit rate over face coverage**: With 5M faces and 90K rays, per-face coverage is meaningless. Ray hit rate (93%+ for interiors) and multi-view percentage (% of hit faces seen by 3+ cameras) are actionable metrics.
- **Splat cameras bypass OrbitControls**: The OrbitControls quaternion capture pipeline (move camera, wait 100ms, read back) was designed for standard auto-place where cameras look at scene center. Splat mode needs diverse orientations, so it adds cameras directly to state in one batch.
- **Angular divergence as quality signal**: Mean pairwise angle between neighboring camera forward vectors. < 20° = redundant (all looking same way), 40-60° = good, 85°+ = excellent diversity (splat mode achieves this).

---

## Phase 12: Scene Tab

### What was done
- Added new "Scene" tab to the toolbar with two features
- **Export Complete Blender Scene**: Loads GLB into bpy, adds all user cameras (via `_persist_cameras`) and lights (via `_add_user_lights`), configures render settings, saves as `.blend` in a downloadable ZIP. Checkboxes to include/exclude cameras, lights, override lighting, and render settings.
- **Scene Analysis**: Analyzes the loaded GLB via bpy + bmesh. Reports per-mesh topology (vertices, faces, connected components, UV maps, vertex groups), PBR material analysis (recursive Principled BSDF node tracing for 15 texture input types), and geometry quality (watertight check, intersecting faces via BVHTree, normal orientation, smooth shading, face area distribution). Aggregates into scene-level summary. Downloadable as JSON.
- New module `backend/rendering/scene_analysis.py` with `check_for_pbr()`, `analyze_mesh()`, `analyze_scene()`
- Console toggle to see operation logs
- Barber pole animation on both buttons during processing

### Key decisions
- **Synchronous analysis, not threaded**: bpy is not thread-safe. Running `load_scene` in a thread while another bpy operation is in memory causes SIGSEGV. The analysis endpoint runs synchronously and returns a JSON response directly.
- **Both buttons mutually disabled**: Prevents concurrent bpy operations that would crash the backend.
- **Intersecting face check skipped for large meshes**: BVHTree overlap on meshes with 50K+ faces is too slow for interactive use. Skipped with a size threshold.

---

## Phase 13: Annotations, Connections, and Camera Flythroughs

### What was done

**Annotations tab** (merged Object Detection + Annotations):
- Object detection UI at top of panel (filter, detect, cull, merge, toggle OOBBs)
- Manual annotation: double-click any mesh in 3D viewport to pick it, rename, add to object pool
- Text descriptions per object, persisted in annotations state
- Object connections: 6 relationship types (`adjacent_to`, `on_top_of`, `inside_of`, `part_of`, `supports`, `supported_by`), red connection lines in 3D viewport
- Multi-view object rendering: Fibonacci-sphere 16-view (configurable 8-32) in isolated white studio, per-object or batch, with reference view + OOBB metadata
- Rename objects in pool (updates scene graph, connections, annotations, selection)
- Remove individual objects (×) or clear all from pool
- Configurable views, resolution, samples, optional depth maps
- Console logging, barber pole progress, persistent render state across tab switches

**Flythrough rendering** (on Rendering tab):
- Lerp position + slerp rotation interpolation between camera waypoints
- Configurable frame count (default 300) + FPS (default 30) with calculated duration
- PNG or EXR output with optional depth maps
- Animation-optimized Cycles config: compositor-based denoise (Render Layers → Denoise node with Normal + Albedo passes → Composite), path guiding with deterministic guiding, fixed seed, deep bounces (12 max, 8 glossy, 4 diffuse, 8 transmission), dynamic BVH, light tree, tight adaptive sampling (0.005 threshold)
- Per-frame `camera_data.json` with K matrix, intrinsics, extrinsics

**UI/UX improvements:**
- Renamed app to "Scene Connect"
- Tab order: Scene → Connectivity → Annotations → Rendering
- Connectivity panel: Draw Volume button + description added to panel
- Volume editing: delta clamping to prevent snapping at steep camera angles
- OOBBs: light blue default, orange when selected; double-click to select
- SceneModel wrapped in `React.memo` (prevents viewport flash on annotation selection)
- Persistent render state for both Rendering and Annotations tabs
- GLB import: checkbox to import lights/cameras from GLB as editable Scene Connect objects

### Key decisions
- **Compositor denoise for flythrough, not render-time denoise**: Render-time OIDN produced noisy results (possibly not available on Rosetta). Compositor denoise uses Normal + Albedo auxiliary passes for temporally stable results even at low sample counts.
- **Merged Object Detection into Annotations tab**: Reduces tab count, natural workflow (detect → annotate → connect → render multi-view).
- **Double-click for all interactive picking**: Prevents conflicts with orbit controls (single click = orbit, double-click = select).
- **Scene graph rename**: Renaming an object in the pool actually changes `meshObj.name` in the Three.js scene graph, ensuring consistency with OOBB highlighting and export.
- **Splat cameras bypass OrbitControls**: OrbitControls was overriding diverse splat-mode quaternions. Splat cameras are added directly to state in one batch.

---

## Phase 14: Curvature-Weighted Point Cloud Generation

### What was done

**Point cloud generation** (on Scene tab):
- New backend module `backend/rendering/point_cloud_generator.py` implementing the full 6-step pipeline:
  1. Join all scene meshes into single object with world-space transforms applied
  2. Cache material/texture data (using `foreach_get` into numpy arrays for performance)
  3. Compute per-vertex curvature via dihedral angles, percentile-clipped normalization, gamma correction
  4. Curvature-weighted point sampling with stochastic rounding, vectorised via numpy (barycentric coords, positions, normals, UV sampling all batch-processed)
  5. Apply Pointiness visualisation material (Geometry → ColorRamp → Emission)
  6. Export ASCII PLY with ZIP compression
- 3 presets: Fast (250k pts), Standard (750k pts), Dense (1.5M pts)
- 8 configurable parameters: target points, min density ratio, curvature gamma, percentile clip, seed, sample colours, sample normals, coordinate system (COLMAP/BLENDER)
- Collapsible "Advanced Settings" panel with sliders and editable values
- Generation summary: point count, triangle count, materials, curvature range, config

**Point cloud statistics** (after generation):
- k-NN local density estimation via scipy `cKDTree` on 80k subsample
- Pearson correlation (curvature vs. density) with color-coded interpretation
- Linear regression fit (slope + intercept)
- Quartile density table (mean density per curvature quartile)
- Curvature and density distribution stats (min, max, mean, median, std)
- Downloadable as JSON

**API endpoints:**
- `POST /api/generate-point-cloud` — synchronous (bpy thread safety), returns PLY/ZIP paths + stats
- `POST /api/point-cloud-stats` — synchronous, returns correlation metrics
- Updated `/api/renders/<path:filename>` to support subdirectory serving

### Key decisions
- **Vectorised numpy sampling, not Python for-loops**: The original reference script used per-face Python loops which work in native Blender but hang under Rosetta emulation (5.2M faces). Rewrote Step 4 to extract all triangle data into numpy arrays in one pass, then batch-process all sampling as vectorised operations — ~100x faster.
- **`foreach_get` for pixel buffers**: `list(img.pixels)` on large textures was the second bottleneck under Rosetta. Replaced with `img.pixels.foreach_get(numpy_array)` which bulk-copies into pre-allocated memory.
- **Synchronous endpoint**: Same pattern as scene analysis — bpy is not thread-safe. All bpy-dependent buttons (Export Blend, Analyze Scene, Generate Point Cloud, Compute Stats) are mutually disabled via `anyBusy` flag.
- **COLMAP as default coordinate system**: Matches existing Nerfstudio pipeline (OPENCV camera model in `transforms.json`).
- **scipy dependency**: Added for `cKDTree` in stats computation. Falls back to brute-force numpy if unavailable.

---

## Phase 15: Backdrop Image (World Environment)

### What was done

**Backdrop image upload & preview** (on Rendering tab):
- Drag-and-drop or file picker for equirectangular panoramas (PNG, EXR, HDR)
- Upload via existing chunked upload mechanism (reuses GLB upload flow)
- Three.js skybox preview using `EXRLoader`, `RGBELoader`, or `TextureLoader`
- `PMREMGenerator` for IBL environment map when "Use for lighting" is enabled
- ACES Filmic tone mapping with user-controllable exposure slider
- Strength slider for Blender Background node intensity
- Remove button to revert to default dark background

**Blender World material setup** (`setup_world_backdrop()`):
- Environment Texture → Mapping → Background → World Output node chain
- IBL on: image lights the scene AND is visible as background
- IBL off: Light Path "Is Camera Ray" + MixShader — image only visible to camera rays, black background for other rays (no IBL contribution)
- `_has_backdrop` flag prevents `_ensure_lighting()` from overwriting the world material

**Color management toggle**:
- Dropdown in Render Settings: Standard (accurate colors) or Filmic (compressed highlights)
- Passed through all render endpoints (render, splat, flythrough)
- Filmic recommended when using HDR backdrops with glass/reflective materials (prevents highlight clipping)
- Multiview object renders always use Standard (isolated controlled environment)

**Multiview rendering improvements**:
- Background color picker (default white) with hex input
- Transparent background checkbox (RGBA PNG with `film_transparent`)
- Light Path node separates camera-visible background from lighting (no color bleed)
- Controlled render environment: all scene lights removed, single shadowless sun (energy=3.0, angle=11.4°)
- `view_transform = Standard`, independent of Rendering tab color management setting

### Key decisions
- **Light Path for background isolation**: Both multiview and backdrop use Light Path "Is Camera Ray" to prevent background color from affecting scene lighting through indirect bounces.
- **`_has_backdrop` flag**: Prevents `_ensure_lighting()` from clearing the world material that `setup_world_backdrop()` configured. Without this, the environment texture was overwritten with a flat white background.
- **Standard color management as default**: Filmic compresses highlights (good for HDR windows) but shifts all colors. Standard is more predictable for most use cases. User can switch per-render.
- **HDR format support**: Added `.hdr` (Radiance RGBE) alongside EXR and PNG. Three.js uses `RGBELoader`, Blender loads natively.
- **Multiview fully isolated**: No backdrop, no scene lights, no color management toggle — always Standard + white (or user-chosen) background + single sun. Matches TRELLIS-style controlled renders.
