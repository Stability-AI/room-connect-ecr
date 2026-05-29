"""Blender Cycles renderer for interior scenes.

Renders a single view using the default camera from the GLB scene,
with optional depth map output in 32-bit EXR format.
"""

import os
import sys
import uuid
import logging
from pathlib import Path

import bpy

logger = logging.getLogger(__name__)


class CyclesRenderer:
    def __init__(
        self,
        output_dir: str,
        render_resolution_x: int = 1920,
        render_resolution_y: int = 1080,
        rendering_samples: int = 128,
    ):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.render_resolution_x = render_resolution_x
        self.render_resolution_y = render_resolution_y
        self.rendering_samples = rendering_samples
        self.render_id = str(uuid.uuid4())[:8]

    def load_scene(self, glb_path: str) -> bool:
        """Load a GLB file into Blender, clearing the default scene."""
        logger.info(f"Loading scene: {glb_path}")

        bpy.ops.wm.read_homefile(use_empty=True)

        bpy.ops.import_scene.gltf(filepath=glb_path)

        obj_count = len(bpy.data.objects)
        logger.info(f"Scene loaded: {obj_count} objects")
        return obj_count > 0

    def _find_camera(self):
        """Find the first camera in the scene (from the GLB or default)."""
        for obj in bpy.data.objects:
            if obj.type == "CAMERA":
                return obj

        logger.info("No camera found in GLB, creating default camera")
        bpy.ops.object.camera_add(location=(5, -5, 3))
        cam = bpy.context.object
        cam.name = "DefaultCamera"

        from mathutils import Vector
        direction = Vector((0, 0, 0)) - cam.location
        rot_quat = direction.to_track_quat("-Z", "Y")
        cam.rotation_euler = rot_quat.to_euler()

        return cam

    def _enable_gpu(self):
        """Enable GPU rendering if available."""
        if sys.platform == "darwin":
            logger.info("macOS detected, using CPU rendering")
            bpy.context.scene.cycles.device = "CPU"
            return

        bpy.context.scene.cycles.device = "GPU"

        if "cycles" not in bpy.context.preferences.addons:
            logger.warning("Cycles addon not available, falling back to CPU")
            bpy.context.scene.cycles.device = "CPU"
            return

        render_prefs = bpy.context.preferences.addons["cycles"].preferences

        for gpu_type in ["OPTIX", "CUDA"]:
            render_prefs.compute_device_type = gpu_type
            render_prefs.refresh_devices()

            available = [d for d in render_prefs.devices if d.type == gpu_type]
            if available:
                for d in available:
                    d.use = True
                logger.info(f"Using {gpu_type} with {len(available)} device(s)")
                return

        logger.info("No GPU devices found, using CPU")
        bpy.context.scene.cycles.device = "CPU"

    def configure_render_settings(self):
        """Configure Cycles render settings for the color pass."""
        scene = bpy.context.scene
        scene.render.engine = "CYCLES"

        self._enable_gpu()

        scene.render.resolution_x = self.render_resolution_x
        scene.render.resolution_y = self.render_resolution_y
        scene.render.resolution_percentage = 100

        scene.cycles.samples = self.rendering_samples
        scene.cycles.use_denoising = True
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = 0.01

        scene.cycles.max_bounces = 4
        scene.cycles.glossy_bounces = 4
        scene.cycles.diffuse_bounces = 2
        scene.cycles.transmission_bounces = 2
        scene.cycles.transparent_max_bounces = 8
        scene.cycles.caustics_reflective = False
        scene.cycles.caustics_refractive = False

        scene.render.use_persistent_data = True

        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_depth = "8"
        scene.render.image_settings.color_mode = "RGBA"

        # Disable compositor for color pass
        scene.use_nodes = False

        scene.render.threads_mode = "AUTO"

        logger.info(
            f"Render settings: {self.render_resolution_x}x{self.render_resolution_y}, "
            f"{self.rendering_samples} samples, device={scene.cycles.device}"
        )

    def configure_depthmap_settings(self):
        """Configure Cycles for depth map rendering in 32-bit EXR."""
        scene = bpy.context.scene
        scene.render.engine = "CYCLES"

        self._enable_gpu()

        scene.render.resolution_x = self.render_resolution_x
        scene.render.resolution_y = self.render_resolution_y
        scene.render.resolution_percentage = 100

        scene.cycles.samples = 32
        scene.cycles.use_denoising = False

        scene.render.image_settings.file_format = "OPEN_EXR"
        scene.render.image_settings.color_depth = "32"
        scene.render.image_settings.exr_codec = "ZIP"

        # Enable Z pass
        view_layer = scene.view_layers[0]
        view_layer.use_pass_z = True

        # Set up compositor nodes for depth output
        scene.use_nodes = True
        tree = scene.node_tree
        tree.nodes.clear()
        tree.links.clear()

        render_layers = tree.nodes.new(type="CompositorNodeRLayers")
        render_layers.location = (0, 0)

        normalize = tree.nodes.new(type="CompositorNodeNormalize")
        normalize.location = (300, 0)

        invert = tree.nodes.new(type="CompositorNodeInvert")
        invert.location = (500, 0)

        composite = tree.nodes.new(type="CompositorNodeComposite")
        composite.location = (700, 0)
        composite.use_alpha = True

        tree.links.new(render_layers.outputs["Depth"], normalize.inputs["Value"])
        tree.links.new(normalize.outputs["Value"], invert.inputs["Color"])
        tree.links.new(invert.outputs["Color"], composite.inputs["Image"])

        scene.render.threads_mode = "AUTO"

        logger.info("Depth map settings configured (32-bit EXR, normalized + inverted)")

    def render_single_view(self, generate_depthmap: bool = False) -> dict:
        """
        Render a single view using the scene's default camera.

        Returns a dict with paths to the rendered output(s).
        """
        camera = self._find_camera()
        bpy.context.scene.camera = camera

        logger.info(f"Using camera: {camera.name} at {list(camera.location)}")

        results = {}

        # Render color pass
        self.configure_render_settings()
        color_path = str(self.output_dir / f"render_{self.render_id}.png")
        bpy.context.scene.render.filepath = color_path

        logger.info("Rendering color pass...")
        bpy.ops.render.render(write_still=True)
        results["color"] = color_path
        logger.info(f"Color render saved: {color_path}")

        # Render depth pass if requested
        if generate_depthmap:
            self.configure_depthmap_settings()
            depth_path = str(self.output_dir / f"depth_{self.render_id}.exr")
            bpy.context.scene.render.filepath = depth_path

            logger.info("Rendering depth pass...")
            bpy.ops.render.render(write_still=True)
            results["depth"] = depth_path
            logger.info(f"Depth render saved: {depth_path}")

        return results
