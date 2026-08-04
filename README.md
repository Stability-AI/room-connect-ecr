# Scene Connect

An interactive web-based 3D application for interior scene analysis, annotation, and rendering — analyze scenes, define walkable areas, annotate and connect objects, render high-quality views and flythroughs, and generate Gaussian Splatting training datasets via Blender Cycles.

## What It Does

Scene Connect lets you load large 3D interior scenes (GLTF/GLB, tested up to 700MB) across four tabs:

1. **Scene** — Analyze mesh topology, PBR materials, and geometry quality. Export the complete scene as a Blender `.blend` file with cameras and lights.

2. **Connectivity** — Draw axis-aligned bounding boxes to define walkable areas, set up connectivity relationships between rooms/zones, and export the graph as JSON.

3. **Annotations** — Detect objects by name filter, manually pick and rename meshes, add text descriptions, define spatial relationships (adjacent, on top of, inside, etc.), and render multi-view object captures for 3D reconstruction.

4. **Rendering** — Place cameras manually or automatically, render from all viewpoints, generate Gaussian Splatting datasets (80-400 views with Nerfstudio export), and render camera flythroughs with interpolated paths.

## Screenshots

![Object Detection — OOBBs around detected chairs](docs/screenshot%20(4).png)
*Object Detection: filtering by "chair" with oriented bounding boxes displayed around all matching meshes*

![Rendering — Auto-placed cameras with PBR shading](docs/screenshot(5).png)
*Rendering: auto-placed cameras with viewpoint entropy maximization, shown in PBR shaded mode*

![Wireframe with volume defined](docs/image.png)
*Volume Connectivity: wireframe mode with a walkable volume defined*

![Normal shading with volume drawing](docs/image%20(1).png)
*Drawing a new volume in normal-shaded mode with scale/translate handles*

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React + Three.js (React Three Fiber) |
| Build | Vite |
| Backend | Python / Flask / Blender BPY (Cycles) |
| Deployment | Docker / Docker Compose / AWS EKS (ArgoCD) |

## Quick Start

```bash
# Clone and run
git clone https://github.com/Stability-AI/room-connect.git
cd room-connect
docker-compose up --build
```

Open **http://localhost:3000**

## Features

### Scene Visualization
- 5 shading modes: Normals, Wireframe, Diffuse, Texture (unlit albedo), Shaded (PBR + studio lighting)
- Orthographic/perspective toggle
- Handles scenes up to 700MB+ (loaded client-side via blob URL)

### Volume Connectivity
- Draw, translate, scale axis-aligned bounding boxes
- Name volumes and define connectivity relationships
- Double-click to re-edit existing volumes
- Export connectivity graph as JSON

### Object Detection
- Case-insensitive substring filtering (include/exclude modes)
- Incremental detection: multiple runs accumulate results (deduplicated)
- World-space OOBB computation with 3D wireframe overlays
- Cull nested/overlapping boxes with adjustable sensitivity (protects committed objects)
- Export detected objects as JSON

### Rendering Pipeline
- Blender Cycles via Docker (GPU-accelerated when available, CPU fallback)
- Parallel chunked file upload (4x concurrency, ~3 min for 700MB) with visible progress bar
- Manual camera placement ("Place at View")
- Automatic camera placement (BVH proximity queries, floor detection, inside-mesh validation)
- Constrain to Volume: limit camera placement to a specific room (load connectivity graph or use session data)
- Viewpoint entropy maximization: orient cameras toward detected objects (load objects JSON or use session data)
- Session continuity: volumes and objects from earlier tabs available in Rendering without re-export
- Override FOV (20°–120°) with live viewport preview
- Override lighting with brightness control
- 32-bit EXR depth maps (optimized: 1-sample Cycles, ~32x faster than color pass)
- Real-time render log streaming (SSE)
- ZIP download with renders + depth maps + .blend file (with persisted cameras and lights) + camera intrinsics/extrinsics
- Dynamic frustum aspect ratio matching render dimensions
- Non-convergence dialog with actionable suggestions

### Gaussian Splatting Dataset Generation
- Generate Nerfstudio-compatible training datasets (80-400 high-fidelity views)
- 4 quality presets: Draft (1440p/32 samples), Fast (1080p/256), Balanced (1440p/512), Hero (4K/1024)
- 3-layer camera height distribution optimized for 3DGS reconstruction (low/mid/high)
- Diverse camera orientations: random yaw + height-dependent pitch for full scene coverage
- Interior AABB-based constraint scaling adapts to room size automatically
- Nerfstudio `transforms.json` export (OPENCV model, `camera_angle_x/y`, `aabb_scale` from scene geometry)
- Preview cameras before rendering to verify coverage
- Camera distribution analysis: spatial uniformity (k-NN), angular diversity, frustum coverage with colored 3D visualization and surface heatmap
- No-lights warning prevents wasting render time on dark scenes
- Optional depth maps for depth-supervised training
- Optional HDR EXR output (16-bit half or 32-bit float) with log(1+x) transform for HDR-aware splat methods

### Scene Management
- Hot-swap GLB: replace the loaded scene without page refresh, preserving cameras, lights, and render settings
- Confirmation dialog with options: Keep All / Clear Detection Data / Clear Everything
- Proper Three.js scene disposal (geometries, materials, textures) to prevent memory leaks

### UI
- Double-click any slider value to type an exact number (EditableValue component)
- Selectable lights: click in 3D viewport or list to highlight (orange in 3D, green in list)
- Upload progress bar visible across all tabs during backend upload

### Annotations & Object Connections
- Object detection by name filter + manual mesh picking (double-click in 3D viewport)
- Rename objects in scene graph, add text descriptions
- Define spatial relationships between objects (6 types: adjacent, on top of, inside, part of, supports, supported by)
- Connection lines visualized in 3D viewport (red)
- Multi-view object rendering: Fibonacci-sphere 16-view in isolated studio (configurable views, resolution, samples, depth maps)
- Export annotations as JSON (descriptions, OOBBs, connections)
- GLB import: optionally import lights/cameras from GLB as editable objects

### Camera Flythrough
- Interpolated camera path between placed waypoints (lerp position + slerp rotation)
- Configurable frame count and FPS with calculated duration
- Animation-optimized Cycles: compositor denoise (Normal + Albedo passes), path guiding, fixed seed, deep bounces, light tree
- PNG or EXR output with optional depth maps
- Per-frame camera metadata (K matrix, intrinsics, extrinsics)

### Backdrop Image (World Environment)
- Upload equirectangular panoramas (PNG, EXR, HDR) as scene skybox and IBL lighting source
- Three.js viewport preview with tone mapping and exposure control
- Blender Environment Texture node with configurable strength and IBL toggle
- Color management: Standard (accurate) or Filmic (compressed highlights) selectable per render

### Multiview Object Rendering
- Configurable background color with color picker (default white)
- Transparent background option (RGBA PNG)
- Isolated render environment: single shadowless sun, no scene lights, no backdrop bleed

### Scene Tools
- Export Complete Blender Scene: full `.blend` file with cameras, lights, and render settings
- Scene Analysis: mesh topology, PBR material detection (Principled BSDF node tracing), geometry quality (watertight, normals, intersections), downloadable as JSON report
- Point Cloud Generation: curvature-weighted sampling for 3DGS initialization (250k–1.5M points), with presets, advanced parameter controls, scene-colour baking, and COLMAP/Blender coordinate export
- Point Cloud Statistics: k-NN density estimation, Pearson curvature–density correlation, quartile analysis, downloadable as JSON

### Live Deployment

Scene Connect is deployed on the Stability AI data cluster (`data1-us-west-2`) at `room-connect.data.stability.ai`. CI/CD via GitHub Actions pushes Docker images to ECR on merge; ArgoCD syncs the deployment.

## Documentation

- [User Guide](docs/USER_GUIDE.md) — Step-by-step usage instructions

## Project Structure

```
room-connect/
├── backend/
│   ├── app.py                  # Flask API (upload, render SSE, file serving)
│   ├── rendering/
│   │   └── cycles_renderer.py  # Blender Cycles multi-camera renderer
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx             # Root state management
│   │   ├── components/         # React components (13 files)
│   │   ├── utils/              # Camera placement, object detection, upload
│   │   └── styles/App.css
│   ├── package.json
│   └── vite.config.js
├── docs/                       # Screenshots, user guide, post-mortem
├── docker-compose.yml          # Development multi-service setup
├── Dockerfile                  # Production single-container build
└── README.md
```

## Development

| Task | Command |
|------|---------|
| Start (Docker) | `docker-compose up --build` |
| Frontend only | `cd frontend && npm install && npm run dev` |
| Backend only | `cd backend && pip install -r requirements.txt && python app.py` |
| Production build | `docker build -t room-connect . && docker run -p 8080:8080 room-connect` |

## Troubleshooting

### GLB file fails to load / WebGL Context Lost

GLB files larger than ~1.5GB may crash the browser tab due to memory limits. The browser needs to hold the entire file as a blob URL plus Three.js allocates additional memory for geometry/textures. If you see "Failed to fetch" or "Context Lost" errors, reduce the GLB size by:
- Lowering texture resolution at export
- Splitting into multiple smaller files

Tested working range: up to ~1GB GLB files.

### Draco-compressed GLB files fail to render in backend

The Blender BPY Docker image does not include the Draco decompression library (`libextern_draco.so`). GLB files exported with Draco mesh compression will load fine in the Three.js frontend (which has its own Draco decoder) but will fail when sent to the Blender backend for Cycles rendering.

**Workaround**: Re-export GLB files from Blender without Draco compression enabled (uncheck "Draco Mesh Compression" in the glTF export settings).

### "Render Views" button greyed out / upload fails with 500

Large GLB files (300–700MB) accumulate in the Docker container. If the container disk fills up, uploads fail silently and `sceneFileId` never gets set.

**Fix:** Clean up old uploads inside the container:
```bash
docker-compose exec backend sh -c "rm -rf /tmp/room-connect-uploads/* /tmp/room-connect-renders/*"
```

Then reload the page and re-load the scene.

To prevent this, periodically prune Docker:
```bash
docker system prune -f
```
