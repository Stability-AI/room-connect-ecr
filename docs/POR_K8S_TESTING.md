# POR: K8s Deployment Manual Testing

## Objective

Verify that Room Connect running on the `data1-us-west-2` K8s cluster (CPU realtime pool) works correctly across all major functionality. This covers the frontend (React/Three.js), backend API (Flask), and Blender Cycles rendering (CPU fallback).

## Access

- **URL:** `https://room-connect.data.stability.ai` (or port-forward: `kubectl port-forward svc/room-connect -n data-room-connect 8080:80`)
- **Health endpoint:** `GET /api/health` should return `{"status": "ok"}`

## Test 1: Application Loading

| Step | Action | Expected result | Pass? |
|------|--------|-----------------|-------|
| 1.1 | Navigate to the app URL | React UI loads with toolbar, empty 3D viewport | |
| 1.2 | Check browser console for errors | No errors (warnings are OK) | |
| 1.3 | Verify all three tabs visible in toolbar | Connectivity, Object Detection, Rendering tabs present | |

## Test 2: Scene Loading (Frontend)

| Step | Action | Expected result | Pass? |
|------|--------|-----------------|-------|
| 2.1 | Click "Load Scene (.glb)" and select a test GLB file | File picker opens, file loads | |
| 2.2 | Wait for scene to appear in viewport | 3D geometry renders in the viewport | |
| 2.3 | Orbit the camera (click + drag) | Camera rotates around the scene smoothly | |
| 2.4 | Zoom in/out (scroll wheel) | Camera zooms without lag | |
| 2.5 | Toggle shading modes: Normals, Wireframe, Diffuse, Texture, Shaded | Each mode renders correctly | |
| 2.6 | Toggle orthographic view | Viewport switches between perspective and orthographic | |

**Test files:** Use a small GLB first (~10-50MB) to verify basic loading, then a larger one (~200-700MB) to test chunked upload.

## Test 3: Backend Upload (Chunked)

| Step | Action | Expected result | Pass? |
|------|--------|-----------------|-------|
| 3.1 | Load a GLB (triggers automatic backend upload) | Upload progress indicator appears | |
| 3.2 | Wait for upload to complete | Progress reaches 100%, no errors | |
| 3.3 | Check browser Network tab | Multiple `/api/upload-chunk` POSTs followed by `/api/upload-merge` | |

**If upload fails:** Check for timeout errors (gunicorn should have `--timeout 600`). Large files (>500MB) may take a minute or more over the network.

## Test 4: Volume Connectivity (Connectivity Tab)

| Step | Action | Expected result | Pass? |
|------|--------|-----------------|-------|
| 4.1 | Switch to Connectivity tab | Side panel shows volume controls | |
| 4.2 | Click "Draw Volume" and draw an AABB in the viewport | Volume box appears with drag handles | |
| 4.3 | Name the volume (e.g., "Living Room") | Name appears in the volume list | |
| 4.4 | Draw a second volume | Second box appears | |
| 4.5 | Connect the two volumes | Connection line/indicator shows | |
| 4.6 | Edit a volume (resize using handles) | Volume resizes smoothly | |
| 4.7 | Delete a volume | Volume removed from viewport and list | |
| 4.8 | Export volumes as JSON | JSON file downloads with correct volume data | |
| 4.9 | Load volumes from JSON | Previously exported volumes restore correctly | |

## Test 5: Object Detection (Object Detection Tab)

| Step | Action | Expected result | Pass? |
|------|--------|-----------------|-------|
| 5.1 | Switch to Object Detection tab | Side panel shows filter controls | |
| 5.2 | Enter a mesh name filter (e.g., "chair", "desk") | Detection runs, matching meshes found | |
| 5.3 | OOBBs appear around detected objects | Oriented bounding boxes render as wireframes in viewport | |
| 5.4 | Toggle OOBB visibility | OOBBs show/hide correctly | |
| 5.5 | Run "Cull Overlapping" on results | Overlapping boxes are removed | |
| 5.6 | Run "Merge Overlapping" on results | Nearby boxes merge into larger ones | |
| 5.7 | Export detected objects as JSON | JSON file downloads with OOBB data | |
| 5.8 | Load objects from JSON | Previously exported objects restore correctly | |

## Test 6: Camera Placement (Rendering Tab)

| Step | Action | Expected result | Pass? |
|------|--------|-----------------|-------|
| 6.1 | Switch to Rendering tab | Side panel shows camera and render controls | |
| 6.2 | Click "Place at View" | Camera added at current viewport position | |
| 6.3 | Camera frustum appears in viewport | Pyramid wireframe shows camera FOV and direction | |
| 6.4 | Place 2-3 more cameras at different positions | All frustums visible simultaneously | |
| 6.5 | Select a camera from the list | Viewport jumps to that camera's position | |
| 6.6 | Delete a camera | Camera removed from viewport and list | |
| 6.7 | Run "Auto Place Cameras" | Multiple cameras placed automatically with spacing | |
| 6.8 | Adjust render settings (width, height, samples) | Values update in the panel | |

## Test 7: Blender Cycles Rendering (Backend, CPU)

This is the critical backend test -- Blender runs on the K8s pod's CPU.

| Step | Action | Expected result | Pass? |
|------|--------|-----------------|-------|
| 7.1 | Ensure a scene is loaded and at least one camera is placed | Ready to render | |
| 7.2 | Click "Render" | SSE log stream starts in the debug console | |
| 7.3 | Observe render logs | Logs show "Using CPU" (not GPU), Cycles sample progress | |
| 7.4 | Wait for render to complete | ZIP download link appears | |
| 7.5 | Download the ZIP | ZIP contains: color image(s), depth map(s) (EXR), camera params | |
| 7.6 | Open a color render | Image shows the scene from the camera's perspective | |
| 7.7 | Open a depth map (EXR) | 32-bit depth values, not all black/white | |
| 7.8 | Render with multiple cameras | All cameras render sequentially, logs show progress per camera | |

**Expected render time (CPU):** ~1-5 minutes per camera at default samples (128), depending on scene complexity. This is significantly slower than GPU but functionally identical output.

**If render fails:** Check the SSE log for error messages. Common issues:
- `bpy` import failure (missing system libraries in the Docker image)
- GLB file not found on backend (upload didn't complete)
- Timeout (gunicorn killed the worker before render finished)

## Test 8: Scene Lights (Rendering Tab)

| Step | Action | Expected result | Pass? |
|------|--------|-----------------|-------|
| 8.1 | Add a light in the Rendering tab | Light appears in the list | |
| 8.2 | Adjust light parameters (position, intensity, color) | Values update | |
| 8.3 | Render with custom lights | Render output reflects the lighting changes | |
| 8.4 | Save lights as JSON | JSON file downloads | |
| 8.5 | Load lights from JSON | Previously saved lights restore | |

## Test 9: Large File Handling

| Step | Action | Expected result | Pass? |
|------|--------|-----------------|-------|
| 9.1 | Load a large GLB (~500MB+) | Scene loads in viewport (may take 30-60s) | |
| 9.2 | Backend upload completes | No timeout, progress reaches 100% | |
| 9.3 | Interact with the scene (orbit, zoom) | Viewport remains responsive | |
| 9.4 | Render a single camera | Render completes without OOM or timeout | |

## Test Summary

| Area | Tests | Result |
|------|-------|--------|
| App loading | 1.1 - 1.3 | |
| Scene loading (frontend) | 2.1 - 2.6 | |
| Backend upload | 3.1 - 3.3 | |
| Volume connectivity | 4.1 - 4.9 | |
| Object detection | 5.1 - 5.8 | |
| Camera placement | 6.1 - 6.8 | |
| Blender rendering (CPU) | 7.1 - 7.8 | |
| Scene lights | 8.1 - 8.5 | |
| Large file handling | 9.1 - 9.4 | |

## Known Limitations (CPU Deployment)

- **Render speed:** CPU Cycles is ~10-50x slower than GPU. A single 1920x1080 frame at 128 samples may take 1-5 minutes depending on scene complexity.
- **Concurrent renders:** Only one render at a time per pod (gunicorn gthread worker). Multiple users will queue.
- **Upload persistence:** Uploads use `emptyDir` volume -- they are lost if the pod restarts. This is acceptable for the proof-of-concept phase.

## After Testing

Report results and any issues found. If all core functionality works on CPU, the deployment is validated as a proof of concept. GPU rendering can be re-enabled later by switching the Karpenter pool back to `data-gpu-g6g7` in the kubernetes-data deployment manifest.
