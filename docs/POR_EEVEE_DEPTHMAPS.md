# POR: Switch to EEVEE for Depth Map Rendering

## Rationale

Depth maps don't require path-traced lighting — they only need geometry depth information. Rendering depth maps with Cycles is wasteful since it computes full light transport just to extract the Z-pass. EEVEE (Blender's rasterization engine) can produce identical depth maps in a fraction of the time.

## Current Behaviour

- Depth maps rendered with Cycles at 32 samples
- Uses compositor nodes: Z-pass → Normalize → Invert → Composite
- Same render engine as color pass, just different output settings

## Proposed Change

When rendering depth maps:
1. Switch render engine to `EEVEE` (or `BLENDER_EEVEE_NEXT` for Blender 4.x)
2. Render at 1 sample (depth is deterministic in rasterization)
3. Keep the same compositor node setup (Z-pass → Normalize → Invert)
4. Switch back to Cycles for the color pass

## Implementation

In `backend/rendering/cycles_renderer.py`, update `configure_depthmap_settings()`:

```python
def configure_depthmap_settings(self):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"  # or "BLENDER_EEVEE" for older versions
    
    scene.render.resolution_x = self.render_resolution_x
    scene.render.resolution_y = self.render_resolution_y
    scene.render.resolution_percentage = 100
    
    # EEVEE doesn't need samples for depth
    scene.eevee.taa_render_samples = 1
    
    # Output settings remain the same
    scene.render.image_settings.file_format = "OPEN_EXR"
    scene.render.image_settings.color_depth = "32"
    scene.render.image_settings.exr_codec = "ZIP"
    
    # Compositor nodes remain the same (Z-pass → Normalize → Invert)
    # ...
```

## Benefits

- Depth map rendering ~10-50x faster than Cycles
- No visual quality difference (depth is geometry-only)
- Reduces total render time significantly when depth maps are enabled

## Considerations

- Verify EEVEE Z-pass produces the same depth range as Cycles
- EEVEE must be available in the bpy Docker image (should be included by default)
- The `BLENDER_EEVEE_NEXT` engine name is for Blender 4.x; check bpy version compatibility
