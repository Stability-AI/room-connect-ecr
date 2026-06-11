"""Blender Cycles renderer for interior scenes.

Renders a single view using the default camera from the GLB scene,
with optional depth map output in 32-bit EXR format.
"""

import os
import sys
import uuid
import logging
import json
import zipfile
import io
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
        log_queue=None,
    ):
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.render_resolution_x = render_resolution_x
        self.render_resolution_y = render_resolution_y
        self.rendering_samples = rendering_samples
        self.render_id = str(uuid.uuid4())[:8]
        self.log_buffer = []
        self.log_queue = log_queue

    def _capture_log(self, msg):
        """Capture a log message and stream it via SSE if queue is available."""
        self.log_buffer.append(msg)
        logger.info(msg)
        if self.log_queue:
            self.log_queue.put(("log", msg))

    def load_scene(self, glb_path: str) -> bool:
        """Load a GLB file into Blender, clearing the default scene."""
        self._capture_log(f"Loading scene: {glb_path}")
        self.glb_path = glb_path

        bpy.ops.wm.read_homefile(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=glb_path)

        obj_count = len(bpy.data.objects)
        self._capture_log(f"Scene loaded: {obj_count} objects")

        self._repair_missing_materials_from_gltf(glb_path)

        return obj_count > 0

    def _repair_missing_materials_from_gltf(self, glb_path: str):
        """
        Parse the GLB file's glTF JSON. Rebuild materials that have a
        baseColorTexture defined in glTF (fixing broken importer connections).
        Leave materials WITHOUT a baseColorTexture untouched (glass, emissive, etc).
        """
        import struct
        import json as json_mod

        with open(glb_path, "rb") as f:
            magic = f.read(4)
            if magic != b"glTF":
                self._capture_log("Not a valid GLB file, skipping material repair")
                return

            version, length = struct.unpack("<II", f.read(8))

            chunk_length, chunk_type = struct.unpack("<II", f.read(8))
            if chunk_type != 0x4E4F534A:
                self._capture_log("GLB has no JSON chunk, skipping material repair")
                return

            json_data = json_mod.loads(f.read(chunk_length).decode("utf-8"))

        gltf_materials = json_data.get("materials", [])
        gltf_textures = json_data.get("textures", [])
        gltf_images = json_data.get("images", [])

        if not gltf_materials:
            self._capture_log("No materials in glTF data")
            return

        blender_images = list(bpy.data.images)

        self._capture_log(
            f"Repairing materials: {len(gltf_materials)} glTF materials, "
            f"{len(blender_images)} Blender images available"
        )

        rebuilt = 0
        skipped = 0

        for mat in bpy.data.materials:
            if not mat.use_nodes or not mat.node_tree:
                continue

            # Find matching glTF material by name
            gltf_mat = None
            for gm in gltf_materials:
                if gm.get("name") == mat.name:
                    gltf_mat = gm
                    break

            if not gltf_mat:
                continue

            pbr = gltf_mat.get("pbrMetallicRoughness", {})
            base_color_tex_info = pbr.get("baseColorTexture")

            # Only rebuild materials that HAVE a baseColorTexture in glTF.
            # Materials without one (solid colors, glass, emissive) are left as-is.
            if base_color_tex_info is None:
                skipped += 1
                continue

            base_color_factor = pbr.get("baseColorFactor", [1, 1, 1, 1])
            metallic_factor = pbr.get("metallicFactor", 1.0)
            roughness_factor = pbr.get("roughnessFactor", 1.0)
            metallic_roughness_tex_info = pbr.get("metallicRoughnessTexture")
            normal_tex_info = gltf_mat.get("normalTexture")
            emissive_tex_info = gltf_mat.get("emissiveTexture")
            emissive_factor = gltf_mat.get("emissiveFactor", [0, 0, 0])

            # Clear and rebuild this material's node tree
            tree = mat.node_tree
            tree.nodes.clear()
            tree.links.clear()

            principled = tree.nodes.new(type="ShaderNodeBsdfPrincipled")
            principled.location = (300, 0)

            output = tree.nodes.new(type="ShaderNodeOutputMaterial")
            output.location = (600, 0)
            tree.links.new(principled.outputs["BSDF"], output.inputs["Surface"])

            principled.inputs["Base Color"].default_value = (
                base_color_factor[0], base_color_factor[1],
                base_color_factor[2], 1.0
            )
            principled.inputs["Metallic"].default_value = metallic_factor
            principled.inputs["Roughness"].default_value = roughness_factor

            # Base color texture
            tex_img = self._get_blender_image_for_texture(
                base_color_tex_info, gltf_textures, gltf_images, blender_images
            )
            if tex_img:
                tex_node = tree.nodes.new(type="ShaderNodeTexImage")
                tex_node.location = (0, 0)
                tex_node.image = tex_img
                tex_img.colorspace_settings.name = "sRGB"
                tree.links.new(tex_node.outputs["Color"], principled.inputs["Base Color"])

            # Metallic/Roughness texture
            if metallic_roughness_tex_info is not None:
                mr_img = self._get_blender_image_for_texture(
                    metallic_roughness_tex_info, gltf_textures, gltf_images, blender_images
                )
                if mr_img:
                    mr_node = tree.nodes.new(type="ShaderNodeTexImage")
                    mr_node.location = (0, -300)
                    mr_node.image = mr_img
                    mr_img.colorspace_settings.name = "Non-Color"
                    sep = tree.nodes.new(type="ShaderNodeSeparateColor")
                    sep.location = (200, -300)
                    tree.links.new(mr_node.outputs["Color"], sep.inputs["Color"])
                    tree.links.new(sep.outputs["Green"], principled.inputs["Roughness"])
                    tree.links.new(sep.outputs["Blue"], principled.inputs["Metallic"])

            # Normal texture
            if normal_tex_info is not None:
                n_img = self._get_blender_image_for_texture(
                    normal_tex_info, gltf_textures, gltf_images, blender_images
                )
                if n_img:
                    n_node = tree.nodes.new(type="ShaderNodeTexImage")
                    n_node.location = (0, -600)
                    n_node.image = n_img
                    n_img.colorspace_settings.name = "Non-Color"
                    nm = tree.nodes.new(type="ShaderNodeNormalMap")
                    nm.location = (200, -600)
                    tree.links.new(n_node.outputs["Color"], nm.inputs["Color"])
                    tree.links.new(nm.outputs["Normal"], principled.inputs["Normal"])

            # Emissive texture
            if emissive_tex_info is not None:
                e_img = self._get_blender_image_for_texture(
                    emissive_tex_info, gltf_textures, gltf_images, blender_images
                )
                if e_img:
                    e_node = tree.nodes.new(type="ShaderNodeTexImage")
                    e_node.location = (0, -900)
                    e_node.image = e_img
                    e_img.colorspace_settings.name = "sRGB"
                    tree.links.new(e_node.outputs["Color"], principled.inputs["Emission Color"])
                    principled.inputs["Emission Strength"].default_value = 1.0

            rebuilt += 1

        self._capture_log(
            f"Material repair: {rebuilt} rebuilt (had baseColorTexture), "
            f"{skipped} skipped (no texture, left as-is)"
        )

    def _get_blender_image_for_texture(self, tex_info, gltf_textures, gltf_images, blender_images):
        """Resolve a glTF texture reference to a Blender image object."""
        tex_index = tex_info.get("index")
        if tex_index is None or tex_index >= len(gltf_textures):
            return None

        gltf_tex = gltf_textures[tex_index]
        source_index = gltf_tex.get("source")
        if source_index is None or source_index >= len(gltf_images):
            return None

        gltf_img = gltf_images[source_index]
        img_name = gltf_img.get("name", "")

        # Try to find matching Blender image by name
        for bimg in blender_images:
            if bimg.name == img_name or bimg.name.startswith(img_name):
                return bimg

        # Fallback: try by index (images imported in order)
        if source_index < len(blender_images):
            return blender_images[source_index]

        return None

    def _find_camera(self):
        """Find the first camera in the scene, or create one at a sensible position."""
        for obj in bpy.data.objects:
            if obj.type == "CAMERA":
                self._capture_log(f"Found existing camera: {obj.name}")
                return obj

        self._capture_log("No camera found in GLB, creating default camera based on scene bounds")

        from mathutils import Vector

        min_co = Vector((float("inf"),) * 3)
        max_co = Vector((float("-inf"),) * 3)

        for obj in bpy.data.objects:
            if obj.type == "MESH":
                bbox = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
                for co in bbox:
                    min_co.x = min(min_co.x, co.x)
                    min_co.y = min(min_co.y, co.y)
                    min_co.z = min(min_co.z, co.z)
                    max_co.x = max(max_co.x, co.x)
                    max_co.y = max(max_co.y, co.y)
                    max_co.z = max(max_co.z, co.z)

        center = (min_co + max_co) / 2
        size = max_co - min_co
        max_dim = max(size.x, size.y, size.z)

        cam_pos = Vector((
            center.x + size.x * 0.4,
            center.y - size.y * 0.4,
            center.z + size.z * 0.3,
        ))

        bpy.ops.object.camera_add(location=cam_pos)
        cam = bpy.context.object
        cam.name = "DefaultCamera"
        cam.data.lens = 24
        cam.data.clip_start = 0.1
        cam.data.clip_end = max_dim * 10

        direction = center - cam_pos
        rot_quat = direction.to_track_quat("-Z", "Y")
        cam.rotation_euler = rot_quat.to_euler()

        self._capture_log(f"Created camera at {list(cam_pos)} looking at {list(center)}")
        return cam

    def _add_user_lights(self, lights):
        """Add user-placed directional (sun) lights to the Blender scene."""
        import math
        from mathutils import Vector

        for i, light_data in enumerate(lights):
            pos = light_data["position"]
            direction = light_data.get("direction", [0, 0, -1])
            intensity = light_data.get("intensity", 500)

            # Convert position from Y-up to Z-up
            blender_pos = (pos[0], -pos[2], pos[1])

            bpy.ops.object.light_add(type="SUN", location=blender_pos)
            light = bpy.context.object
            light.name = f"UserLight_{i}"
            light.data.energy = intensity * 0.01  # Sun lights use lower energy scale

            # Convert direction from Y-up to Z-up and orient the light
            blender_dir = Vector((direction[0], -direction[2], direction[1]))
            target = Vector(blender_pos) + blender_dir * 10

            # Point the light in the direction
            direction_vec = (target - Vector(blender_pos)).normalized()
            up = Vector((0, 0, 1))
            right = direction_vec.cross(up)
            if right.length < 0.001:
                up = Vector((0, 1, 0))
                right = direction_vec.cross(up)
            right.normalize()
            actual_up = right.cross(direction_vec).normalized()

            from mathutils import Matrix
            rot_matrix = Matrix((right, actual_up, -direction_vec)).transposed().to_4x4()
            light.rotation_euler = rot_matrix.to_euler()

        self._capture_log(f"Added {len(lights)} user-placed directional lights")

    def _ensure_lighting(self, override_lighting: bool = False, brightness: float = 1.5):
        """Add or override lighting in the scene."""
        has_lights = any(obj.type == "LIGHT" for obj in bpy.data.objects)

        if override_lighting or not has_lights:
            if override_lighting and has_lights:
                self._capture_log("Override lighting enabled — removing existing lights")
                for obj in list(bpy.data.objects):
                    if obj.type == "LIGHT":
                        bpy.data.objects.remove(obj, do_unlink=True)

            self._capture_log("Setting up bright architectural studio lighting (even illumination)")

            from mathutils import Vector

            # Compute scene bounds for scaling
            min_co = Vector((float("inf"),) * 3)
            max_co = Vector((float("-inf"),) * 3)
            for obj in bpy.data.objects:
                if obj.type == "MESH":
                    bbox = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
                    for co in bbox:
                        min_co.x = min(min_co.x, co.x)
                        min_co.y = min(min_co.y, co.y)
                        min_co.z = min(min_co.z, co.z)
                        max_co.x = max(max_co.x, co.x)
                        max_co.y = max(max_co.y, co.y)
                        max_co.z = max(max_co.z, co.z)
            center = (min_co + max_co) / 2
            size = max_co - min_co
            max_dim = max(size.x, size.y, size.z)
            scale_factor = max_dim / 10.0

            # Very bright world environment for even base illumination
            world = bpy.data.worlds.get("World")
            if not world:
                world = bpy.data.worlds.new("World")
            bpy.context.scene.world = world
            world.use_nodes = True
            tree = world.node_tree
            tree.nodes.clear()

            bg = tree.nodes.new(type="ShaderNodeBackground")
            bg.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
            bg.inputs["Strength"].default_value = 15.0 * brightness
            output = tree.nodes.new(type="ShaderNodeOutputWorld")
            tree.links.new(bg.outputs["Background"], output.inputs["Surface"])

            # 6 large area lights from all directions for shadowless even illumination
            light_configs = [
                {"name": "TopLight", "energy": 5000, "pos": (0, 0, 1.5), "size": 20},
                {"name": "FrontLight", "energy": 4000, "pos": (0, -1.2, 0.5), "size": 18},
                {"name": "BackLight", "energy": 4000, "pos": (0, 1.2, 0.5), "size": 18},
                {"name": "LeftLight", "energy": 3500, "pos": (-1.2, 0, 0.5), "size": 16},
                {"name": "RightLight", "energy": 3500, "pos": (1.2, 0, 0.5), "size": 16},
                {"name": "BottomFill", "energy": 3000, "pos": (0, 0, -0.5), "size": 20},
            ]

            for cfg in light_configs:
                pos = Vector((
                    center.x + cfg["pos"][0] * max_dim * 0.6,
                    center.y + cfg["pos"][1] * max_dim * 0.6,
                    center.z + cfg["pos"][2] * max_dim * 0.6,
                ))
                bpy.ops.object.light_add(type="AREA", location=pos)
                light = bpy.context.object
                light.name = cfg["name"]
                light.data.energy = cfg["energy"] * (scale_factor ** 2) * brightness
                light.data.size = cfg["size"] * scale_factor

                direction = center - pos
                rot_quat = direction.to_track_quat("-Z", "Y")
                light.rotation_euler = rot_quat.to_euler()

            self._capture_log(
                f"Added 6 area lights + bright environment (world=8.0, scale={scale_factor:.1f})"
            )
        else:
            self._capture_log("Scene has existing lights, using them")

    def _enable_gpu(self):
        """Enable GPU rendering if available."""
        if sys.platform == "darwin":
            self._capture_log("macOS detected, using CPU rendering")
            bpy.context.scene.cycles.device = "CPU"
            return

        bpy.context.scene.cycles.device = "GPU"

        if "cycles" not in bpy.context.preferences.addons:
            self._capture_log("Cycles addon not available, falling back to CPU")
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
                self._capture_log(f"Using {gpu_type} with {len(available)} device(s)")
                return

        self._capture_log("No GPU devices found, using CPU")
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

        scene.use_nodes = False
        scene.render.threads_mode = "AUTO"

        self._capture_log(
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

        view_layer = scene.view_layers[0]
        view_layer.use_pass_z = True

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

        self._capture_log("Depth map settings configured (32-bit EXR, normalized + inverted)")

    def render_single_view(self, generate_depthmap: bool = False, override_lighting: bool = False, lighting_brightness: float = 1.5, include_blend: bool = False) -> dict:
        """
        Render a single view using the scene's default camera.

        Returns a dict with paths to the rendered output(s) and logs.
        """
        self.log_buffer = []

        camera = self._find_camera()
        bpy.context.scene.camera = camera
        self._ensure_lighting(override_lighting=override_lighting, brightness=lighting_brightness)

        self._capture_log(f"Using camera: {camera.name} at {list(camera.location)}")

        results = {"files": [], "logs": []}

        # Render color pass
        self.configure_render_settings()
        color_path = str(self.output_dir / f"render_{self.render_id}.png")
        bpy.context.scene.render.filepath = color_path

        self._capture_log(f"Rendering color pass ({self.rendering_samples} samples)...")
        bpy.ops.render.render(write_still=True)
        results["files"].append({"type": "color", "path": color_path, "filename": f"render_{self.render_id}.png"})
        self._capture_log(f"Color render saved: {color_path}")

        # Render depth pass if requested
        if generate_depthmap:
            self.configure_depthmap_settings()
            depth_path = str(self.output_dir / f"depth_{self.render_id}.exr")
            bpy.context.scene.render.filepath = depth_path

            self._capture_log("Rendering depth pass...")
            bpy.ops.render.render(write_still=True)
            results["files"].append({"type": "depth", "path": depth_path, "filename": f"depth_{self.render_id}.exr"})
            self._capture_log(f"Depth render saved: {depth_path}")

        # Save .blend file if requested
        if include_blend:
            blend_path = str(self.output_dir / f"scene_{self.render_id}.blend")
            bpy.ops.wm.save_as_mainfile(filepath=blend_path)
            results["files"].append({"type": "blend", "path": blend_path, "filename": f"scene_{self.render_id}.blend"})
            self._capture_log(f"Blender scene saved: {blend_path}")

        results["logs"] = self.log_buffer
        return results

    def render_all_views(self, cameras: list, generate_depthmap: bool = False, override_lighting: bool = False, lighting_brightness: float = 1.5, include_blend: bool = False, lights: list = None) -> dict:
        """
        Render from multiple camera positions.
        Each camera dict has: id, name, position, quaternion, fov.
        Lights list (optional): each has position, quaternion, intensity, size.
        """
        self.log_buffer = []
        self._ensure_lighting(override_lighting=override_lighting, brightness=lighting_brightness)

        # Add user-placed lights AFTER override lighting (so they don't get removed)
        if lights:
            self._add_user_lights(lights)

        results = {"files": [], "logs": []}
        total = len(cameras)

        from mathutils import Quaternion as MQuaternion, Vector, Matrix
        import math

        # Rotation to convert from Three.js Y-up to Blender Z-up: 90° around X
        yup_to_zup = MQuaternion((math.cos(math.pi / 4), math.sin(math.pi / 4), 0, 0))

        for idx, cam_data in enumerate(cameras):
            cam_name = cam_data.get("name", f"Camera_{idx}")
            self._capture_log(f"Rendering view {idx + 1}/{total}: {cam_name}")

            bpy.ops.object.camera_add()
            cam_obj = bpy.context.object
            cam_obj.name = f"RenderCam_{idx}"
            cam_obj.data.sensor_fit = 'VERTICAL'
            cam_obj.data.angle = (cam_data.get("fov", 49.13) * 3.14159265) / 180.0
            cam_obj.data.clip_start = 0.1
            cam_obj.data.clip_end = 10000

            # Convert position from Y-up (Three.js) to Z-up (Blender)
            pos = cam_data["position"]
            cam_obj.location = (pos[0], -pos[2], pos[1])

            # Convert quaternion from Three.js (XYZW, Y-up) to Blender (WXYZ, Z-up)
            q = cam_data["quaternion"]
            threejs_quat = MQuaternion((q[3], q[0], q[1], q[2]))  # Convert XYZW to WXYZ
            blender_quat = yup_to_zup @ threejs_quat
            cam_obj.rotation_mode = "QUATERNION"
            cam_obj.rotation_quaternion = blender_quat

            bpy.context.scene.camera = cam_obj

            # Render color pass
            self.configure_render_settings()
            color_filename = f"render_{cam_name}_{self.render_id}.png"
            color_path = str(self.output_dir / color_filename)
            bpy.context.scene.render.filepath = color_path
            bpy.ops.render.render(write_still=True)
            results["files"].append({"type": "color", "path": color_path, "filename": color_filename})
            self._capture_log(f"  Color saved: {color_filename}")

            # Render depth pass
            if generate_depthmap:
                self.configure_depthmap_settings()
                depth_filename = f"depth_{cam_name}_{self.render_id}.exr"
                depth_path = str(self.output_dir / depth_filename)
                bpy.context.scene.render.filepath = depth_path
                bpy.ops.render.render(write_still=True)
                results["files"].append({"type": "depth", "path": depth_path, "filename": depth_filename})
                self._capture_log(f"  Depth saved: {depth_filename}")

            # Clean up camera object
            bpy.data.objects.remove(cam_obj, do_unlink=True)

        # Save .blend file if requested
        if include_blend:
            blend_path = str(self.output_dir / f"scene_{self.render_id}.blend")
            bpy.ops.wm.save_as_mainfile(filepath=blend_path)
            results["files"].append({"type": "blend", "path": blend_path, "filename": f"scene_{self.render_id}.blend"})
            self._capture_log(f"Blender scene saved: {blend_path}")

        self._capture_log(f"Completed {total} views")
        results["logs"] = self.log_buffer
        return results

    def create_zip(self, results: dict) -> str:
        """Package all rendered files into a zip archive."""
        zip_path = str(self.output_dir / f"renders_{self.render_id}.zip")

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for file_info in results["files"]:
                zf.write(file_info["path"], file_info["filename"])

        self._capture_log(f"Created zip archive: {zip_path}")
        return zip_path
