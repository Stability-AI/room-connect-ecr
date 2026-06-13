# POR: Hot-Swap GLB File

## Feature Description

Allow the user to replace the currently loaded GLB scene with a new version without refreshing the webpage. All existing state (cameras, lights, volumes, detected objects) should be preserved — only the 3D geometry/materials update.

## Current Behaviour

When the user clicks "Load Scene (.glb)" and selects a file:
- The old blob URL is revoked
- A new blob URL is created
- `sceneUrl` state changes, triggering SceneModel to reload via `useGLTF`
- **Problem**: `useGLTF` from drei caches by URL. New blob URL = different cache key = full reload works. BUT:
  - All volumes are cleared (`setVolumes([])`)
  - All detected objects are cleared (`setDetectedObjects([])`)
  - Scene cameras remain (not cleared)
  - The old scene's Three.js objects (geometries, textures, materials) may not be properly disposed, causing memory leaks

## Desired Behaviour

1. User clicks "Load Scene" (or a new "Update Scene" button)
2. File picker opens, user selects the new GLB
3. The 3D scene updates to show the new geometry/materials
4. **Preserved state**:
   - All placed cameras (positions, orientations)
   - All scene lights
   - Render settings (width, height, samples, FOV)
   - Loaded volumes and detected objects (from JSON files)
5. **Optionally cleared** (user choice via dialog):
   - Session-detected objects (may be invalid for new geometry)
   - Session-drawn volumes (may not match new layout)
6. The backend receives the new GLB via chunked upload (replacing the old one)
7. No page refresh required

## Implementation Plan

### Frontend Changes

#### 1. Separate "Update Scene" button or reuse "Load Scene"
- When a scene is already loaded, "Load Scene" becomes a hot-swap operation
- Show a confirmation dialog: "Update scene? Cameras and lights will be preserved. Clear volumes/objects?"
  - Options: "Keep All" / "Clear Detection Data" / "Clear Everything"

#### 2. Proper scene disposal
- Before loading the new scene, dispose the old one:
  ```javascript
  scene.traverse((child) => {
    if (child.isMesh) {
      child.geometry?.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    }
  });
  ```
- Clear the `useGLTF` cache for the old URL: `useGLTF.clear()`

#### 3. State preservation
- Do NOT reset cameras, lights, render settings on file load
- Optionally reset volumes and detected objects (based on user choice)
- Reset `sceneRef` so object detection re-traverses the new scene graph

#### 4. Backend upload
- Upload new GLB to backend (same chunked upload flow)
- Old file can be cleaned up after new one is confirmed

### Backend Changes

- No significant changes needed — the render endpoint already accepts a `sceneId` per request
- Old uploads are already retained; could add cleanup of previous version after swap confirmed

## Edge Cases

- If the new GLB has different scale/position, cameras may be in wrong locations → warn user
- If the new GLB has different object names, detected objects won't match → suggest re-detection
- Memory: ensure old scene is fully disposed before loading new one to avoid OOM
