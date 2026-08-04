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
        self._has_backdrop = False

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
        """Add user-placed lights (spot or area) to the Blender scene with power + exposure."""
        import math
        from mathutils import Vector

        for i, light_data in enumerate(lights):
            pos = light_data["position"]
            direction = light_data.get("direction", [0, 0, -1])
            intensity = min(light_data.get("intensity", 10000), 1000000)
            exposure = min(light_data.get("exposure", 0), 1.0)
            light_type = light_data.get("type", "spot")

            # Convert position from Y-up to Z-up
            blender_pos = Vector((pos[0], -pos[2], pos[1]))

            # Convert direction from Y-up to Z-up
            blender_dir = Vector((direction[0], -direction[2], direction[1])).normalized()

            if light_type == "area":
                size_x = light_data.get("sizeX", 1.0)
                size_y = light_data.get("sizeY", 1.0)
                bpy.ops.object.light_add(type="AREA", location=blender_pos)
                light = bpy.context.object
                light.name = f"UserAreaLight_{i}"
                light.data.energy = intensity
                light.data.shape = "RECTANGLE"
                light.data.size = size_x
                light.data.size_y = size_y
                light.data.spread = math.radians(180)
                self._capture_log(f"  Area Light {i}: pos={list(blender_pos)}, power={intensity}, exp={exposure}, size={size_x}x{size_y}")
            else:
                angle = light_data.get("angle", 120)
                bpy.ops.object.light_add(type="SPOT", location=blender_pos)
                light = bpy.context.object
                light.name = f"UserSpotLight_{i}"
                light.data.energy = intensity
                light.data.spot_size = math.radians(angle)
                light.data.spot_blend = 0.5
                light.data.shadow_soft_size = 2.0
                self._capture_log(f"  Spot Light {i}: pos={list(blender_pos)}, power={intensity}, exp={exposure}, angle={angle}°")

            # Set exposure via use_nodes (Cycles light nodes support exposure)
            if exposure > 0:
                light.data.use_nodes = True
                emission_node = light.data.node_tree.nodes.get("Emission")
                if emission_node:
                    emission_node.inputs["Strength"].default_value = intensity * (2 ** exposure)
                    self._capture_log(f"    Effective energy with exposure: {intensity * (2 ** exposure):.0f}")

            # Normalize flag
            light.data.use_custom_distance = False

            # Orient the light to point in the view direction (-Z local axis)
            target = blender_pos + blender_dir * 10
            direction_to_target = (target - blender_pos).normalized()
            track_quat = direction_to_target.to_track_quat('-Z', 'Y')
            light.rotation_euler = track_quat.to_euler()

        self._capture_log(f"Added {len(lights)} user-placed lights")

    def _persist_cameras(self, cameras):
        """Create persistent Blender Camera objects from the user's camera list.

        Called before saving .blend so all user cameras are included in the file.
        Uses the same Y-up to Z-up coordinate conversion as render_all_views.
        """
        import math
        from mathutils import Quaternion as MQuaternion

        yup_to_zup = MQuaternion((math.cos(math.pi / 4), math.sin(math.pi / 4), 0, 0))

        first_cam_obj = None
        for idx, cam_data in enumerate(cameras):
            cam_name = cam_data.get("name", f"Camera_{idx}")

            cam_blender = bpy.data.cameras.new(cam_name)
            cam_blender.sensor_fit = 'VERTICAL'
            cam_blender.angle = (cam_data.get("fov", 49.13) * math.pi) / 180.0
            cam_blender.clip_start = 0.1
            cam_blender.clip_end = 10000

            cam_obj = bpy.data.objects.new(cam_name, cam_blender)
            bpy.context.collection.objects.link(cam_obj)

            pos = cam_data["position"]
            cam_obj.location = (pos[0], -pos[2], pos[1])

            q = cam_data["quaternion"]
            threejs_quat = MQuaternion((q[3], q[0], q[1], q[2]))
            blender_quat = yup_to_zup @ threejs_quat
            cam_obj.rotation_mode = "QUATERNION"
            cam_obj.rotation_quaternion = blender_quat

            if first_cam_obj is None:
                first_cam_obj = cam_obj

        if first_cam_obj:
            bpy.context.scene.camera = first_cam_obj

        self._capture_log(f"Persisted {len(cameras)} cameras to .blend (active: {cameras[0].get('name', 'Camera_0') if cameras else 'none'})")

    def setup_world_backdrop(self, image_path: str, strength: float = 1.0, use_for_lighting: bool = True):
        """Configure the World material to use an environment texture as backdrop."""
        world = bpy.data.worlds.get("World")
        if not world:
            world = bpy.data.worlds.new("World")
        bpy.context.scene.world = world
        world.use_nodes = True
        tree = world.node_tree
        tree.nodes.clear()

        env_tex = tree.nodes.new(type="ShaderNodeTexEnvironment")
        env_tex.image = bpy.data.images.load(image_path)
        env_tex.interpolation = "Linear"

        tex_coord = tree.nodes.new(type="ShaderNodeTexCoord")
        mapping = tree.nodes.new(type="ShaderNodeMapping")
        tree.links.new(tex_coord.outputs["Generated"], mapping.inputs["Vector"])
        tree.links.new(mapping.outputs["Vector"], env_tex.inputs["Vector"])

        bg = tree.nodes.new(type="ShaderNodeBackground")
        bg.inputs["Strength"].default_value = strength
        tree.links.new(env_tex.outputs["Color"], bg.inputs["Color"])

        output = tree.nodes.new(type="ShaderNodeOutputWorld")

        if use_for_lighting:
            tree.links.new(bg.outputs["Background"], output.inputs["Surface"])
        else:
            light_path = tree.nodes.new(type="ShaderNodeLightPath")
            mix = tree.nodes.new(type="ShaderNodeMixShader")

            bg_dark = tree.nodes.new(type="ShaderNodeBackground")
            bg_dark.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
            bg_dark.inputs["Strength"].default_value = 0.0

            tree.links.new(light_path.outputs["Is Camera Ray"], mix.inputs["Fac"])
            tree.links.new(bg_dark.outputs["Background"], mix.inputs[1])
            tree.links.new(bg.outputs["Background"], mix.inputs[2])
            tree.links.new(mix.outputs["Shader"], output.inputs["Surface"])

        self._has_backdrop = True
        self._capture_log(f"World backdrop set: {os.path.basename(image_path)} (strength={strength}, IBL={'on' if use_for_lighting else 'off'})")

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

            # World environment: skip if a backdrop image was configured
            # (setup_world_backdrop already set up the Environment Texture nodes)
            if not self._has_backdrop:
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

    def configure_render_settings(self, color_management="standard"):
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

        view_transform = "Filmic" if color_management == "filmic" else "Standard"
        scene.view_settings.view_transform = view_transform
        scene.view_settings.look = "None"
        scene.view_settings.exposure = 0.0
        scene.view_settings.gamma = 1.0

        scene.use_nodes = False
        scene.render.threads_mode = "AUTO"

        self._capture_log(
            f"Render settings: {self.render_resolution_x}x{self.render_resolution_y}, "
            f"{self.rendering_samples} samples, device={scene.cycles.device}, "
            f"color={view_transform}"
        )

    def configure_depthmap_settings(self):
        """Configure Cycles for depth map rendering in 32-bit EXR.

        Uses 1 sample with no denoising -- depth only needs geometry information,
        not light transport. Compositor nodes normalize and invert the Z-pass.
        """
        scene = bpy.context.scene
        scene.render.engine = "CYCLES"

        self._enable_gpu()

        scene.render.resolution_x = self.render_resolution_x
        scene.render.resolution_y = self.render_resolution_y
        scene.render.resolution_percentage = 100

        scene.cycles.samples = 1
        scene.cycles.use_denoising = False

        scene.render.image_settings.file_format = "OPEN_EXR"
        scene.render.image_settings.color_depth = "32"
        scene.render.image_settings.exr_codec = "ZIP"

        for vl in scene.view_layers:
            vl.use_pass_z = True

        scene.use_nodes = True
        scene.render.use_compositing = True
        tree = scene.node_tree
        if tree is None:
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

        tree.links.new(render_layers.outputs["Depth"], normalize.inputs["Value"])
        tree.links.new(normalize.outputs["Value"], invert.inputs["Color"])
        tree.links.new(invert.outputs["Color"], composite.inputs["Image"])

        scene.render.threads_mode = "AUTO"

        self._capture_log("Depth map settings configured (1 sample, 32-bit EXR, normalized + inverted)")

    def render_single_view(self, generate_depthmap: bool = False, override_lighting: bool = False, lighting_brightness: float = 1.5, include_blend: bool = False, color_management: str = "standard") -> dict:
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
        self.configure_render_settings(color_management=color_management)
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

    def render_all_views(self, cameras: list, generate_depthmap: bool = False, override_lighting: bool = False, lighting_brightness: float = 1.5, include_blend: bool = False, lights: list = None, color_management: str = "standard") -> dict:
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
            self.configure_render_settings(color_management=color_management)
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

        # Save .blend file if requested (with persistent cameras)
        if include_blend:
            self._persist_cameras(cameras)
            blend_path = str(self.output_dir / f"scene_{self.render_id}.blend")
            bpy.ops.wm.save_as_mainfile(filepath=blend_path)
            results["files"].append({"type": "blend", "path": blend_path, "filename": f"scene_{self.render_id}.blend"})
            self._capture_log(f"Blender scene saved: {blend_path}")

        self._capture_log(f"Completed {total} views")
        results["logs"] = self.log_buffer
        return results

    # =========================================================================
    # GAUSSIAN SPLAT DATASET GENERATION
    # =========================================================================

    SPLAT_PRESETS = {
        "draft":    {"resolution": (2560, 1440), "samples": 32,   "max_bounces": 8,  "diffuse_bounces": 4, "glossy_bounces": 4},
        "fast":     {"resolution": (1920, 1080), "samples": 256,  "max_bounces": 8,  "diffuse_bounces": 4, "glossy_bounces": 4},
        "balanced": {"resolution": (2560, 1440), "samples": 512,  "max_bounces": 12, "diffuse_bounces": 8, "glossy_bounces": 6},
        "hero":     {"resolution": (3840, 2160), "samples": 1024, "max_bounces": 12, "diffuse_bounces": 8, "glossy_bounces": 6},
    }

    def configure_splat_settings(self, preset="balanced", resolution_x=None, resolution_y=None, samples=None, hdr_format=None, color_management="standard"):
        """Configure Cycles for high-fidelity splat training data.

        hdr_format: None for PNG, "exr16" for 16-bit half EXR, "exr32" for 32-bit float EXR.
        """
        p = self.SPLAT_PRESETS.get(preset, self.SPLAT_PRESETS["balanced"])
        rx = resolution_x or p["resolution"][0]
        ry = resolution_y or p["resolution"][1]
        s = samples or p["samples"]

        scene = bpy.context.scene
        scene.render.engine = "CYCLES"
        self._enable_gpu()

        scene.render.resolution_x = rx
        scene.render.resolution_y = ry
        scene.render.resolution_percentage = 100

        scene.cycles.samples = s
        scene.cycles.seed = 0
        scene.cycles.use_animated_seed = False

        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = 0.01
        scene.cycles.adaptive_min_samples = 256

        scene.cycles.use_denoising = True
        try:
            scene.cycles.denoiser = "OPENIMAGEDENOISE"
            scene.cycles.denoising_prefilter = "ACCURATE"
        except Exception:
            pass

        scene.cycles.sample_clamp_direct = 0
        scene.cycles.sample_clamp_indirect = 20

        scene.cycles.max_bounces = p["max_bounces"]
        scene.cycles.diffuse_bounces = p["diffuse_bounces"]
        scene.cycles.glossy_bounces = p["glossy_bounces"]
        scene.cycles.transmission_bounces = 8
        scene.cycles.transparent_max_bounces = 8
        scene.cycles.caustics_reflective = False
        scene.cycles.caustics_refractive = False

        scene.render.use_persistent_data = True
        scene.cycles.use_guiding = False

        scene.render.film_transparent = False

        if hdr_format:
            scene.render.image_settings.file_format = "OPEN_EXR"
            scene.render.image_settings.color_depth = "16" if hdr_format == "exr16" else "32"
            scene.render.image_settings.exr_codec = "ZIP"
            scene.render.image_settings.color_mode = "RGB"
            scene.view_settings.view_transform = "Raw"
            for vl in scene.view_layers:
                vl.use_pass_z = False
                vl.use_pass_normal = False
                vl.use_pass_vector = False
                vl.use_pass_mist = False
        else:
            scene.render.image_settings.file_format = "PNG"
            scene.render.image_settings.color_mode = "RGB"
            scene.render.image_settings.color_depth = "8"
            scene.view_settings.view_transform = "Filmic" if color_management == "filmic" else "Standard"

        scene.view_settings.look = "None"
        scene.view_settings.exposure = 0.0
        scene.view_settings.gamma = 1.0

        scene.use_nodes = False
        scene.render.use_compositing = False

        fmt_label = hdr_format.upper() if hdr_format else "PNG"
        self._capture_log(
            f"Splat settings: {rx}x{ry}, {s} samples, {p['max_bounces']} bounces, "
            f"preset={preset}, format={fmt_label}, device={scene.cycles.device}"
        )
        return rx, ry

    def _get_camera_matrix_world(self, cam_obj):
        """Extract camera matrix_world in OpenGL convention (row-major 4x4).

        Blender's camera convention (-Z forward, +Y up) matches OpenGL,
        so matrix_world can be used directly for Nerfstudio transforms.json.
        """
        m = cam_obj.matrix_world
        return [[m[row][col] for col in range(4)] for row in range(4)]

    def _get_camera_intrinsics(self, cam_obj, width, height):
        """Extract focal length in pixels from Blender camera data."""
        cam_data = cam_obj.data
        sensor_width = cam_data.sensor_width
        focal_mm = cam_data.lens

        if cam_data.sensor_fit == "VERTICAL":
            sensor_height = cam_data.sensor_height
            fy = (height * focal_mm) / sensor_height
            fx = fy
        else:
            fx = (width * focal_mm) / sensor_width
            fy = fx

        return fx, fy, width / 2.0, height / 2.0

    def _compute_scene_aabb_scale(self):
        """Compute the max dimension of the scene geometry AABB."""
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
        return float(max(max_co.x - min_co.x, max_co.y - min_co.y, max_co.z - min_co.z))

    def export_nerfstudio_transforms(self, camera_entries, width, height, output_path):
        """Write Nerfstudio-compatible transforms.json in PINHOLE format."""
        import math
        if not camera_entries:
            return

        fx, fy, cx, cy = camera_entries[0]["intrinsics"]
        camera_angle_x = 2.0 * math.atan(width / (2.0 * fx))
        camera_angle_y = 2.0 * math.atan(height / (2.0 * fy))
        aabb_scale = self._compute_scene_aabb_scale()

        transforms = {
            "camera_model": "OPENCV",
            "w": width,
            "h": height,
            "camera_angle_x": camera_angle_x,
            "camera_angle_y": camera_angle_y,
            "fl_x": fx,
            "fl_y": fy,
            "cx": cx,
            "cy": cy,
            "k1": 0.0,
            "k2": 0.0,
            "p1": 0.0,
            "p2": 0.0,
            "aabb_scale": round(aabb_scale, 6),
            "frames": [
                {
                    "file_path": entry["file_path"],
                    "transform_matrix": entry["transform_matrix"],
                }
                for entry in camera_entries
            ],
        }

        with open(output_path, "w") as f:
            json.dump(transforms, f, indent=4)
        self._capture_log(f"Saved transforms.json ({len(camera_entries)} frames, aabb_scale={aabb_scale:.1f})")

    def _apply_log_transform_exr(self, exr_path):
        """Apply log(1 + x) transform to an EXR file in-place.

        Compresses HDR dynamic range into a space where 3DGS loss functions
        converge properly. Monotonic and invertible via exp(y) - 1.
        """
        import numpy as np

        img = bpy.data.images.load(exr_path)
        w, h = img.size
        pixels = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, img.channels)

        pixels[..., :3] = np.log1p(np.maximum(pixels[..., :3], 0))

        img.pixels = pixels.flatten().tolist()
        img.save()
        bpy.data.images.remove(img)

    def render_splat_dataset(self, cameras, preset="balanced", resolution_x=None,
                             resolution_y=None, samples=None, generate_depth=False,
                             override_lighting=False, lighting_brightness=1.5,
                             lights=None, hdr_format=None, log_transform=False,
                             color_management="standard"):
        """Render all cameras at high fidelity and export Nerfstudio dataset.

        hdr_format: None for PNG, "exr16" for 16-bit half EXR, "exr32" for 32-bit float EXR.
        log_transform: If True and hdr_format is set, apply log(1+x) to EXR frames.
        """
        import math
        from mathutils import Quaternion as MQuaternion, Vector, Matrix

        self.log_buffer = []
        rx, ry = self.configure_splat_settings(preset, resolution_x, resolution_y, samples, hdr_format=hdr_format, color_management=color_management)
        frame_ext = ".exr" if hdr_format else ".png"

        self._ensure_lighting(override_lighting=override_lighting, brightness=lighting_brightness)
        if lights:
            self._add_user_lights(lights)

        yup_to_zup = MQuaternion((math.cos(math.pi / 4), math.sin(math.pi / 4), 0, 0))

        results = {"files": [], "logs": []}
        camera_entries = []
        total = len(cameras)

        images_dir = self.output_dir / f"splat_{self.render_id}" / "images"
        images_dir.mkdir(parents=True, exist_ok=True)
        depth_dir = self.output_dir / f"splat_{self.render_id}" / "depth"
        if generate_depth:
            depth_dir.mkdir(parents=True, exist_ok=True)

        for idx, cam_data in enumerate(cameras):
            cam_name = cam_data.get("name", f"Camera_{idx}")
            self._capture_log(f"Rendering splat frame {idx + 1}/{total}: {cam_name}")

            bpy.ops.object.camera_add()
            cam_obj = bpy.context.object
            cam_obj.name = f"SplatCam_{idx}"
            cam_obj.data.sensor_fit = 'VERTICAL'
            cam_obj.data.angle = (cam_data.get("fov", 49.13) * 3.14159265) / 180.0
            cam_obj.data.clip_start = 0.1
            cam_obj.data.clip_end = 10000

            pos = cam_data["position"]
            cam_obj.location = (pos[0], -pos[2], pos[1])

            q = cam_data["quaternion"]
            threejs_quat = MQuaternion((q[3], q[0], q[1], q[2]))
            blender_quat = yup_to_zup @ threejs_quat
            cam_obj.rotation_mode = "QUATERNION"
            cam_obj.rotation_quaternion = blender_quat

            bpy.context.scene.camera = cam_obj

            frame_filename = f"{idx:04d}{frame_ext}"
            frame_path = str(images_dir / frame_filename)
            bpy.context.scene.render.filepath = frame_path
            bpy.ops.render.render(write_still=True)
            results["files"].append({"type": "color", "path": frame_path, "filename": f"images/{frame_filename}"})

            transform_matrix = self._get_camera_matrix_world(cam_obj)
            intrinsics = self._get_camera_intrinsics(cam_obj, rx, ry)
            camera_entries.append({
                "file_path": f"images/{frame_filename}",
                "transform_matrix": transform_matrix,
                "intrinsics": intrinsics,
            })

            if generate_depth:
                self.configure_depthmap_settings()
                depth_filename = f"{idx:04d}.png"
                depth_path = str(depth_dir / depth_filename)
                bpy.context.scene.render.filepath = depth_path
                bpy.ops.render.render(write_still=True)
                results["files"].append({"type": "depth", "path": depth_path, "filename": f"depth/{depth_filename}"})
                self.configure_splat_settings(preset, resolution_x, resolution_y, samples, hdr_format=hdr_format, color_management=color_management)

            bpy.data.objects.remove(cam_obj, do_unlink=True)
            self._capture_log(f"  Frame {idx + 1}/{total} complete")

        if hdr_format and log_transform:
            self._capture_log("Applying log(1+x) transform to HDR frames...")
            for file_info in results["files"]:
                if file_info["type"] == "color" and file_info["path"].endswith(".exr"):
                    self._apply_log_transform_exr(file_info["path"])
            self._capture_log("Log transform complete")

        transforms_path = str(self.output_dir / f"splat_{self.render_id}" / "transforms.json")
        self.export_nerfstudio_transforms(camera_entries, rx, ry, transforms_path)
        results["files"].append({"type": "transforms", "path": transforms_path, "filename": "transforms.json"})

        self._capture_log(f"Splat dataset complete: {total} frames + transforms.json")
        results["logs"] = self.log_buffer
        return results

    # =========================================================================
    # MULTI-VIEW OBJECT RENDERING
    # =========================================================================

    def render_object_multiview(self, objects, num_views=16, resolution=512,
                                 samples=32, generate_depth=False,
                                 bg_color=None, transparent_bg=False):
        """Render each object in isolation from Fibonacci-sphere viewpoints."""
        import math
        from mathutils import Vector, Euler

        if bg_color is None:
            bg_color = [1.0, 1.0, 1.0]

        self.log_buffer = []
        results = {"files": [], "logs": []}

        base_dir = self.output_dir / f"objects_{self.render_id}"
        base_dir.mkdir(parents=True, exist_ok=True)

        scene = bpy.context.scene
        scene.render.engine = "CYCLES"
        self._enable_gpu()
        scene.render.resolution_x = resolution
        scene.render.resolution_y = resolution
        scene.cycles.samples = samples
        scene.cycles.use_denoising = True
        scene.render.image_settings.file_format = "PNG"
        scene.render.image_settings.color_mode = "RGBA" if transparent_bg else "RGB"
        scene.render.image_settings.color_depth = "8"
        scene.render.film_transparent = transparent_bg
        scene.use_nodes = False
        scene.render.use_compositing = False

        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"

        # Controlled object render environment: background color visible to
        # camera rays only, neutral white for lighting rays (no color bleed).
        # All existing scene lights removed; single shadowless sun added.
        scene.render.film_transparent = transparent_bg
        if bpy.data.worlds:
            world = bpy.data.worlds[0]
        else:
            world = bpy.data.worlds.new("World")
        scene.world = world
        world.use_nodes = True
        tree = world.node_tree
        tree.nodes.clear()

        light_path = tree.nodes.new(type="ShaderNodeLightPath")
        bg_camera = tree.nodes.new(type="ShaderNodeBackground")
        bg_camera.inputs[0].default_value = (bg_color[0], bg_color[1], bg_color[2], 1.0)
        bg_camera.inputs[1].default_value = 1.0

        bg_lighting = tree.nodes.new(type="ShaderNodeBackground")
        bg_lighting.inputs[0].default_value = (1.0, 1.0, 1.0, 1.0)
        bg_lighting.inputs[1].default_value = 1.0

        mix = tree.nodes.new(type="ShaderNodeMixShader")
        tree.links.new(light_path.outputs["Is Camera Ray"], mix.inputs["Fac"])
        tree.links.new(bg_lighting.outputs["Background"], mix.inputs[1])
        tree.links.new(bg_camera.outputs["Background"], mix.inputs[2])

        output_node = tree.nodes.new(type="ShaderNodeOutputWorld")
        tree.links.new(mix.outputs["Shader"], output_node.inputs["Surface"])

        for obj in list(bpy.data.objects):
            if obj.type == "LIGHT":
                bpy.data.objects.remove(obj, do_unlink=True)

        light_data = bpy.data.lights.new(name="ObjectRenderSun", type="SUN")
        light_data.energy = 3.0
        light_data.use_shadow = False
        light_data.angle = math.radians(11.4)
        light_obj = bpy.data.objects.new("ObjectRenderSun", light_data)
        bpy.context.collection.objects.link(light_obj)
        light_obj.rotation_euler = (math.radians(-250), math.radians(-150), math.radians(-250))

        golden_angle = math.pi * (3.0 - math.sqrt(5.0))
        radius_scale = 2.0
        pitch_range = (-1.55, 1.55)
        object_fov_deg = 40.0

        all_mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]

        for obj_idx, obj_data in enumerate(objects):
            obj_name = obj_data.get("name", f"Object_{obj_idx}")
            safe_name = obj_name.replace("/", "_").replace("\\", "_").replace(" ", "_")
            self._capture_log(f"Rendering object {obj_idx + 1}/{len(objects)}: {obj_name}")

            target_obj = None
            for mesh_obj in all_mesh_objs:
                if mesh_obj.name == obj_name or obj_name in mesh_obj.name:
                    target_obj = mesh_obj
                    break

            if not target_obj:
                self._capture_log(f"  Object not found: {obj_name}, skipping")
                continue

            # Hide all except target
            for o in all_mesh_objs:
                o.hide_render = (o != target_obj)
                o.hide_viewport = (o != target_obj)

            # Compute object bounds
            world_matrix = target_obj.matrix_world
            bbox_world = [world_matrix @ Vector(corner) for corner in target_obj.bound_box]
            obj_min = Vector((min(v.x for v in bbox_world), min(v.y for v in bbox_world), min(v.z for v in bbox_world)))
            obj_max = Vector((max(v.x for v in bbox_world), max(v.y for v in bbox_world), max(v.z for v in bbox_world)))
            obj_center = (obj_min + obj_max) / 2.0
            obj_dims = obj_max - obj_min
            camera_radius = max(obj_dims) * radius_scale

            obj_dir = base_dir / safe_name
            rgb_dir = obj_dir / "rgb"
            rgb_dir.mkdir(parents=True, exist_ok=True)

            bpy.ops.object.camera_add()
            cam_obj = bpy.context.object
            cam_obj.data.angle = (object_fov_deg * math.pi) / 180.0
            cam_obj.data.clip_start = 0.1
            cam_obj.data.clip_end = 10000
            scene.camera = cam_obj

            view_meta = {"object_name": obj_name, "description": obj_data.get("description", ""), "num_views": num_views, "views": []}

            # Reference view
            ref_euler = Euler((math.radians(63), math.radians(0), math.radians(45)), 'XYZ')
            ref_dir = Vector((0, 0, -1))
            ref_dir.rotate(ref_euler)
            cam_obj.location = obj_center - ref_dir * camera_radius
            direction = obj_center - cam_obj.location
            cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

            ref_path = str(rgb_dir / f"{safe_name}_ref.png")
            scene.render.filepath = ref_path
            bpy.ops.render.render(write_still=True)
            results["files"].append({"type": "color", "path": ref_path, "filename": f"{safe_name}/rgb/{safe_name}_ref.png"})

            # Fibonacci sphere views
            for view_idx in range(num_views):
                z = 1.0 - (2.0 * view_idx + 1.0) / num_views
                pitch = max(pitch_range[0], min(pitch_range[1], math.asin(z)))
                yaw = (view_idx * golden_angle) % (2.0 * math.pi)
                cos_pitch = math.cos(pitch)
                cam_pos = Vector((
                    obj_center.x + camera_radius * math.sin(yaw) * cos_pitch,
                    obj_center.y + camera_radius * math.cos(yaw) * cos_pitch,
                    obj_center.z + camera_radius * math.sin(pitch),
                ))
                cam_obj.location = cam_pos
                direction = obj_center - cam_pos
                cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()

                view_path = str(rgb_dir / f"{safe_name}_view_{view_idx:02d}.png")
                scene.render.filepath = view_path
                bpy.ops.render.render(write_still=True)
                results["files"].append({"type": "color", "path": view_path, "filename": f"{safe_name}/rgb/{safe_name}_view_{view_idx:02d}.png"})

                m = cam_obj.matrix_world
                view_meta["views"].append({
                    "view_index": view_idx,
                    "file": f"{safe_name}_view_{view_idx:02d}.png",
                    "transform_matrix": [[m[r][c] for c in range(4)] for r in range(4)],
                })

            bpy.data.objects.remove(cam_obj, do_unlink=True)

            # Save per-object metadata
            meta_path = str(obj_dir / f"{safe_name}_meta.json")
            with open(meta_path, "w") as f:
                json.dump({**view_meta, "oobb": obj_data.get("oobb", {}), "worldPosition": obj_data.get("worldPosition", [])}, f, indent=2)
            results["files"].append({"type": "metadata", "path": meta_path, "filename": f"{safe_name}/{safe_name}_meta.json"})

            self._capture_log(f"  Completed {num_views} views for {obj_name}")

        # Unhide all
        for o in all_mesh_objs:
            o.hide_render = False
            o.hide_viewport = False

        self._capture_log(f"Object multiview complete: {len(objects)} objects")
        results["logs"] = self.log_buffer
        return results

    # =========================================================================
    # FLYTHROUGH RENDERING
    # =========================================================================

    def render_flythrough(self, cameras, total_frames=300, fps=30,
                          output_format="png", generate_depth=False,
                          override_lighting=False, lighting_brightness=1.5,
                          lights=None, color_management="standard"):
        """Render interpolated flythrough between camera waypoints."""
        import math
        from mathutils import Quaternion as MQuaternion, Vector

        self.log_buffer = []
        self._capture_log(f"Starting flythrough: {total_frames} frames, {fps} fps, {len(cameras)} waypoints")

        self._ensure_lighting(override_lighting=override_lighting, brightness=lighting_brightness)
        if lights:
            self._add_user_lights(lights)

        scene = bpy.context.scene
        scene.render.engine = "CYCLES"
        self._enable_gpu()
        scene.render.resolution_x = self.render_resolution_x
        scene.render.resolution_y = self.render_resolution_y
        scene.render.resolution_percentage = 100
        scene.cycles.samples = self.rendering_samples

        # Animation-optimized render setup:
        # Denoising disabled -- compositor denoise is more temporally stable
        # but requires separate pass setup. For now, rely on high samples + fixed seed.
        scene.cycles.use_denoising = False

        # Persistent data: cache BVH, textures between frames
        scene.render.use_persistent_data = True

        # Path guiding: learns light distribution, reduces variance/flicker
        scene.cycles.use_guiding = True
        scene.cycles.use_deterministic_guiding = True
        scene.cycles.guiding_training_samples = 128

        # Adaptive sampling: tight threshold for dark area convergence
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.adaptive_threshold = 0.005
        scene.cycles.adaptive_min_samples = 64

        # Clamp indirect to suppress fireflies; direct unclamped
        scene.cycles.sample_clamp_indirect = 10.0
        scene.cycles.sample_clamp_direct = 0.0

        # Fixed seed: every frame gets the same noise pattern,
        # eliminating temporal flicker entirely
        scene.cycles.seed = 0
        scene.cycles.use_animated_seed = False

        # Dynamic BVH for lower peak memory
        scene.cycles.debug_bvh_type = "DYNAMIC_BVH"
        scene.cycles.debug_use_compact_bvh = True

        # Deep bounces for interiors
        scene.cycles.max_bounces = 12
        scene.cycles.glossy_bounces = 8
        scene.cycles.diffuse_bounces = 4
        scene.cycles.transmission_bounces = 8
        scene.cycles.caustics_reflective = False
        scene.cycles.caustics_refractive = False
        scene.cycles.transparent_max_bounces = 128

        # Light tree for improved light sampling
        try:
            scene.cycles.use_light_tree = True
        except Exception:
            pass

        # Enable denoising data passes for compositor denoise
        for vl in scene.view_layers:
            vl.cycles.denoising_store_passes = True

        # Compositor denoise: more temporally stable than render-time denoise.
        # Uses auxiliary passes (Normal, Albedo) to anchor the result.
        scene.use_nodes = True
        scene.render.use_compositing = True
        tree = scene.node_tree
        if tree is None:
            scene.use_nodes = True
            tree = scene.node_tree
        tree.nodes.clear()
        tree.links.clear()

        rl_node = tree.nodes.new(type="CompositorNodeRLayers")
        rl_node.location = (0, 0)
        denoise_node = tree.nodes.new(type="CompositorNodeDenoise")
        denoise_node.location = (300, 0)
        composite_node = tree.nodes.new(type="CompositorNodeComposite")
        composite_node.location = (600, 0)

        tree.links.new(rl_node.outputs["Image"], denoise_node.inputs["Image"])
        tree.links.new(rl_node.outputs["Denoising Normal"], denoise_node.inputs["Normal"])
        tree.links.new(rl_node.outputs["Denoising Albedo"], denoise_node.inputs["Albedo"])
        tree.links.new(denoise_node.outputs["Image"], composite_node.inputs["Image"])

        self._capture_log("Compositor denoise pipeline configured (Normal + Albedo passes)")

        is_exr = output_format == "exr"
        if is_exr:
            scene.render.image_settings.file_format = "OPEN_EXR"
            scene.render.image_settings.color_depth = "16"
            scene.render.image_settings.exr_codec = "ZIP"
            scene.render.image_settings.color_mode = "RGB"
            scene.view_settings.view_transform = "Raw"
        else:
            scene.render.image_settings.file_format = "PNG"
            scene.render.image_settings.color_mode = "RGB"
            scene.render.image_settings.color_depth = "8"
            scene.view_settings.view_transform = "Filmic" if color_management == "filmic" else "Standard"

        scene.view_settings.look = "None"
        scene.view_settings.exposure = 0.0
        scene.view_settings.gamma = 1.0

        ext = ".exr" if is_exr else ".png"
        yup_to_zup = MQuaternion((math.cos(math.pi / 4), math.sin(math.pi / 4), 0, 0))

        # Convert camera waypoints to Blender coords
        waypoints = []
        for cam_data in cameras:
            pos = cam_data["position"]
            blender_pos = Vector((pos[0], -pos[2], pos[1]))
            q = cam_data["quaternion"]
            threejs_quat = MQuaternion((q[3], q[0], q[1], q[2]))
            blender_quat = yup_to_zup @ threejs_quat
            waypoints.append({"pos": blender_pos, "quat": blender_quat, "fov": cam_data.get("fov", 60)})

        if len(waypoints) < 2:
            self._capture_log("Need at least 2 cameras for flythrough")
            return {"files": [], "logs": self.log_buffer}

        results = {"files": [], "logs": []}
        base_dir = self.output_dir / f"flythrough_{self.render_id}"
        frames_dir = base_dir / "frames"
        frames_dir.mkdir(parents=True, exist_ok=True)
        if generate_depth:
            depth_dir = base_dir / "depth"
            depth_dir.mkdir(parents=True, exist_ok=True)

        bpy.ops.object.camera_add()
        cam_obj = bpy.context.object
        cam_obj.name = "FlythroughCam"
        cam_obj.data.clip_start = 0.1
        cam_obj.data.clip_end = 10000
        cam_obj.rotation_mode = "QUATERNION"
        scene.camera = cam_obj

        frame_metadata = {}
        num_waypoints = len(waypoints)

        for frame in range(total_frames):
            t = frame / max(total_frames - 1, 1)
            segment = t * (num_waypoints - 1)
            i = min(int(segment), num_waypoints - 2)
            frac = segment - i

            # Lerp position
            pos = waypoints[i]["pos"].lerp(waypoints[i + 1]["pos"], frac)
            # Slerp rotation
            quat = waypoints[i]["quat"].slerp(waypoints[i + 1]["quat"], frac)
            # Lerp FOV
            fov = waypoints[i]["fov"] * (1 - frac) + waypoints[i + 1]["fov"] * frac

            cam_obj.location = pos
            cam_obj.rotation_quaternion = quat
            cam_obj.data.angle = (fov * math.pi) / 180.0

            frame_num = frame + 1
            frame_path = str(frames_dir / f"frame_{frame_num:04d}{ext}")
            scene.render.filepath = frame_path
            bpy.ops.render.render(write_still=True)
            results["files"].append({"type": "color", "path": frame_path, "filename": f"frames/frame_{frame_num:04d}{ext}"})

            if generate_depth:
                self.configure_depthmap_settings()
                depth_path = str(depth_dir / f"frame_{frame_num:04d}.exr")
                scene.render.filepath = depth_path
                bpy.ops.render.render(write_still=True)
                results["files"].append({"type": "depth", "path": depth_path, "filename": f"depth/frame_{frame_num:04d}.exr"})
                # Restore color + compositor denoise settings
                if is_exr:
                    scene.render.image_settings.file_format = "OPEN_EXR"
                    scene.render.image_settings.color_depth = "16"
                    scene.render.image_settings.exr_codec = "ZIP"
                    scene.view_settings.view_transform = "Raw"
                else:
                    scene.render.image_settings.file_format = "PNG"
                    scene.render.image_settings.color_depth = "8"
                    scene.view_settings.view_transform = "Standard"
                scene.cycles.samples = self.rendering_samples
                scene.use_nodes = True
                scene.render.use_compositing = True

            # Camera metadata
            m = cam_obj.matrix_world
            wq = cam_obj.matrix_world.to_quaternion()
            cam_data_obj = cam_obj.data
            sensor_w = cam_data_obj.sensor_width
            focal_mm = cam_data_obj.lens
            fx = (self.render_resolution_x * focal_mm) / sensor_w
            fy = fx

            frame_metadata[str(frame_num)] = {
                "frame_number": frame_num,
                "file_path": f"frames/frame_{frame_num:04d}{ext}",
                "intrinsics": {
                    "K": [[fx, 0, self.render_resolution_x / 2], [0, fy, self.render_resolution_y / 2], [0, 0, 1]],
                    "fov_degrees": fov,
                    "focal_length_px": {"fx": fx, "fy": fy},
                    "principal_point": {"cx": self.render_resolution_x / 2, "cy": self.render_resolution_y / 2},
                },
                "extrinsics": {
                    "position": [float(pos.x), float(pos.y), float(pos.z)],
                    "quaternion_xyzw": [float(wq.x), float(wq.y), float(wq.z), float(wq.w)],
                    "world_matrix": [[m[r][c] for c in range(4)] for r in range(4)],
                },
            }

            if frame_num % 25 == 0 or frame_num == total_frames:
                self._capture_log(f"  Frame {frame_num}/{total_frames}")

        bpy.data.objects.remove(cam_obj, do_unlink=True)

        # Save metadata
        meta = {
            "scene_name": bpy.path.basename(bpy.data.filepath),
            "render_width": self.render_resolution_x,
            "render_height": self.render_resolution_y,
            "total_frames": total_frames,
            "fps": fps,
            "waypoints": len(cameras),
            "frames": frame_metadata,
        }
        meta_path = str(base_dir / "camera_data.json")
        with open(meta_path, "w") as f:
            json.dump(meta, f, indent=2)
        results["files"].append({"type": "metadata", "path": meta_path, "filename": "camera_data.json"})

        self._capture_log(f"Flythrough complete: {total_frames} frames from {len(cameras)} waypoints")
        results["logs"] = self.log_buffer
        return results

    def create_splat_zip(self, results: dict) -> str:
        """Package splat dataset into a zip with Nerfstudio folder structure."""
        zip_path = str(self.output_dir / f"splat_dataset_{self.render_id}.zip")

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for file_info in results["files"]:
                zf.write(file_info["path"], file_info["filename"])

        self._capture_log(f"Created splat dataset zip: {zip_path}")
        return zip_path

    def create_zip(self, results: dict) -> str:
        """Package all rendered files into a zip archive."""
        zip_path = str(self.output_dir / f"renders_{self.render_id}.zip")

        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for file_info in results["files"]:
                zf.write(file_info["path"], file_info["filename"])

        self._capture_log(f"Created zip archive: {zip_path}")
        return zip_path
