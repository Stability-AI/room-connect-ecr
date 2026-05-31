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
- Exported JSON can be re-loaded in the Rendering tab for entropy-based camera orientation

---

## Phase 2: Rendering Pipeline

### GLB Upload (Frontend → Backend)
- **Decision**: Option B — Chunked streaming upload
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
- Output packaged as ZIP (optionally includes .blend file for inspection)
- SSE (Server-Sent Events) streams render logs to frontend debug console in real-time

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

## Lessons Learned

1. **Large file handling**: Client-side blob URLs bypass upload limits for visualization; chunked streaming (10MB/chunk) solves backend transfer for 700MB+ files.

2. **Coordinate systems**: Three.js (Y-up) vs Blender (Z-up) requires position swap `(x, -z, y)` and quaternion rotation for camera poses.

3. **Material import fidelity**: Blender's glTF importer doesn't always connect textures correctly. Parsing the GLB JSON header and selectively rebuilding materials with `baseColorTexture` fixes this while preserving glass/emissive materials.

4. **React Three Fiber quaternions**: Computing quaternions outside the R3F render loop (via standalone PerspectiveCamera or Matrix4.lookAt) produces different results than the OrbitControls-managed camera. The solution: let the scene camera process each position through a full render frame before capturing.

5. **Override lighting for interiors**: Interior scenes with embedded lights render too dark without boost. A bright world environment (strength 15.0) + 6 scaled area lights from all directions provides even architectural illumination.

6. **BVH for spatial queries in browser**: `three-mesh-bvh` enables the same proximity testing as Trimesh/Blender BVHTree, running entirely client-side at interactive rates on 700MB scenes.
