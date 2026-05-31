# Phase 2 Sub-POR: Camera Placement Fixes and Enhancements

## 1. Fix Frustum Rotation Alignment

The camera frustum pyramids in the 3D view are not perfectly aligned with the actual generated view vector. The position is correct but orientation is slightly offset.

### Investigation areas:
- The `CameraFrustum` component draws the pyramid along -Z in local space. Verify this matches Three.js camera convention (-Z forward).
- Check if `Matrix4.lookAt(eye, target, up)` produces a quaternion that, when applied to a -Z-facing object, points it correctly toward the target.
- Compare the quaternion stored when using "Place at View" (captured from OrbitControls camera) vs auto-generated quaternions (computed via `lookAt` matrix). They may use different conventions.
- Consider that OrbitControls camera quaternion includes the orbit offset — the camera looks at `controls.target`, not straight down -Z. The stored quaternion should reflect the final world orientation.
- Test: place a camera manually, then "Align Viewpoint" — the free camera should match exactly. If it does, the frustum visualization is the issue. If it doesn't, the quaternion storage is wrong.

### Potential fix:
- The frustum may need a 180-degree Y rotation if Three.js `lookAt` convention differs from what the geometry expects.
- Or the `computeCameraOrientations` function may need to produce quaternions using the same method as Three.js `camera.lookAt()` rather than `Matrix4.lookAt()`.

---

## 2. Animated Progress for Auto-Place Button

Add a barber-pole animation to the "Auto-Place Cameras" button while the algorithm is running. Since the BVH construction and sampling can take a few seconds on large scenes, the user needs visual feedback.

### Implementation:
- Add `isGenerating` state to RenderingPanel
- Wrap the `handleAutoPlace` call in a `setTimeout(0)` or use a Web Worker to keep the UI responsive
- Show barber-pole strip below the button (reuse existing `.barber-pole` CSS) while generating
- Disable the button during generation

---

## 3. Expose Camera Placement Parameters

Currently the placement algorithm uses hardcoded ratios. Expose key parameters to the user for fine-tuning.

### Parameters to expose:

| Parameter | Current Default | Description |
|-----------|----------------|-------------|
| Camera count | 10 | Number of cameras to generate |
| Eye height | 30% of floor-to-ceiling | How high cameras are placed |
| Min surface distance | 2% of scene size | Minimum distance from walls/objects |
| Min camera spacing | 5% of scene size | Minimum distance between cameras |
| Max attempts | 10000 | How hard to try before giving up |

### UI:
- Add a collapsible "Advanced Settings" section below the camera count input
- Sliders or number inputs for each parameter
- "Reset to defaults" button
- Consider presets: "Relaxed" (smaller distances, more cameras), "Conservative" (larger distances, fewer cameras), "Dense" (tight spacing, many cameras)

### Additional considerations:
- Allow user to set absolute min/max Y height for cameras (useful for multi-story buildings)
- Option to restrict camera placement to within defined connectivity volumes (from the Connectivity tab)
- Diagnostic output: log how many attempts were needed, success rate, why candidates were rejected
