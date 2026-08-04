"""Flask backend for room-connect: serves the React frontend, handles file uploads,
and provides Blender Cycles rendering via bpy."""

import os
import uuid
import json
import logging
import threading
import queue
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory, send_file, Response, stream_with_context
from flask_cors import CORS
from werkzeug.utils import secure_filename

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

STATIC_DIR = os.environ.get("STATIC_DIR", "../frontend/dist")
app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")
CORS(app)

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/tmp/room-connect-uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

RENDER_DIR = Path(os.environ.get("RENDER_DIR", "/tmp/room-connect-renders"))
RENDER_DIR.mkdir(parents=True, exist_ok=True)

CHUNKS_DIR = UPLOAD_DIR / "chunks"
CHUNKS_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".glb", ".gltf"}
BACKDROP_EXTENSIONS = {".png", ".exr", ".hdr"}


def allowed_file(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


def _resolve_backdrop(data, renderer):
    """If request contains backdropImage, find the file and configure the world material."""
    backdrop = data.get("backdropImage")
    if not backdrop:
        return

    file_id = backdrop.get("fileId", "")
    if not file_id:
        return

    backdrop_path = UPLOAD_DIR / file_id
    if not backdrop_path.exists():
        matches = list(UPLOAD_DIR.glob(f"*{file_id}*"))
        if matches:
            backdrop_path = matches[0]
        else:
            logger.warning(f"Backdrop image not found: {file_id}")
            return

    strength = float(backdrop.get("strength", 1.0))
    use_for_lighting = bool(backdrop.get("useForLighting", True))

    renderer.setup_world_backdrop(
        image_path=str(backdrop_path),
        strength=strength,
        use_for_lighting=use_for_lighting,
    )


# --- Frontend serving ---

@app.route("/")
def serve_frontend():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/<path:path>")
def catch_all(path):
    file_path = Path(app.static_folder) / path
    if file_path.exists():
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")


# --- Health ---

@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


# --- Chunked file upload (Option B) ---

@app.route("/api/upload-chunk", methods=["POST"])
def upload_chunk():
    """Receive a single chunk of a large file upload."""
    filename = request.headers.get("X-Filename", "scene.glb")
    chunk_index = int(request.headers.get("X-Chunk-Index", "0"))
    total_chunks = int(request.headers.get("X-Total-Chunks", "1"))
    upload_id = request.headers.get("X-Upload-Id", str(uuid.uuid4()))

    chunk_dir = CHUNKS_DIR / upload_id
    chunk_dir.mkdir(parents=True, exist_ok=True)

    chunk_path = chunk_dir / f"chunk_{chunk_index:06d}"
    with open(chunk_path, "wb") as f:
        while True:
            data = request.stream.read(1024 * 1024)
            if not data:
                break
            f.write(data)

    logger.info(f"Received chunk {chunk_index + 1}/{total_chunks} for {filename} (upload: {upload_id})")

    return jsonify({
        "chunk_index": chunk_index,
        "total_chunks": total_chunks,
        "upload_id": upload_id,
    })


@app.route("/api/upload-merge", methods=["POST"])
def upload_merge():
    """Merge all chunks into the final file."""
    data = request.get_json()
    filename = secure_filename(data.get("filename", "scene.glb"))
    total_chunks = int(data.get("totalChunks", 1))
    upload_id = data.get("uploadId", "")

    if not upload_id:
        return jsonify({"error": "Missing uploadId"}), 400

    chunk_dir = CHUNKS_DIR / upload_id
    if not chunk_dir.exists():
        return jsonify({"error": "Upload not found"}), 404

    file_id = str(uuid.uuid4())
    final_path = UPLOAD_DIR / f"{file_id}_{filename}"

    with open(final_path, "wb") as out:
        for i in range(total_chunks):
            chunk_path = chunk_dir / f"chunk_{i:06d}"
            if not chunk_path.exists():
                return jsonify({"error": f"Missing chunk {i}"}), 400
            with open(chunk_path, "rb") as chunk_file:
                while True:
                    block = chunk_file.read(4 * 1024 * 1024)
                    if not block:
                        break
                    out.write(block)
            chunk_path.unlink()

    # Clean up chunk directory
    chunk_dir.rmdir()

    file_size = final_path.stat().st_size
    logger.info(f"Merged {total_chunks} chunks into {final_path} ({file_size / 1024 / 1024:.1f} MB)")

    return jsonify({
        "id": file_id,
        "filename": filename,
        "path": str(final_path),
        "size": file_size,
    })


# --- Scene serving ---

@app.route("/api/scenes/<filename>")
def serve_scene(filename: str):
    return send_from_directory(str(UPLOAD_DIR), filename)


# --- Rendering ---

@app.route("/api/render", methods=["POST"])
def render_scene():
    """
    Render via SSE: streams log lines as they happen, then sends a final
    JSON result event with zip URL and output paths.
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body provided"}), 400

    scene_id = data.get("sceneId")
    if not scene_id:
        return jsonify({"error": "Missing sceneId"}), 400

    scene_path = UPLOAD_DIR / scene_id
    if not scene_path.exists():
        matches = list(UPLOAD_DIR.glob(f"*{scene_id}*"))
        if matches:
            scene_path = matches[0]
        else:
            return jsonify({"error": f"Scene file not found: {scene_id}"}), 404

    width = int(data.get("width", 1920))
    height = int(data.get("height", 1080))
    samples = int(data.get("samples", 128))
    generate_depthmap = bool(data.get("generateDepthmap", False))
    override_lighting = bool(data.get("overrideLighting", False))
    lighting_brightness = float(data.get("lightingBrightness", 1.5))
    include_blend = bool(data.get("includeBlend", False))
    color_management = data.get("colorManagement", "standard")
    camera_list = data.get("cameras", [])
    lights_list = data.get("lights", [])

    logger.info(
        f"Render request: {scene_path.name}, {width}x{height}, {samples} samples, "
        f"depth={generate_depthmap}, override_lighting={override_lighting}, "
        f"lights={len(lights_list)}, cameras={len(camera_list)}"
    )

    log_queue = queue.Queue()

    def run_render():
        try:
            from rendering.cycles_renderer import CyclesRenderer

            renderer = CyclesRenderer(
                output_dir=str(RENDER_DIR),
                render_resolution_x=width,
                render_resolution_y=height,
                rendering_samples=samples,
                log_queue=log_queue,
            )

            if not renderer.load_scene(str(scene_path)):
                log_queue.put(("error", json.dumps({"error": "Failed to load scene"})))
                return

            _resolve_backdrop(data, renderer)

            if camera_list:
                results = renderer.render_all_views(
                    cameras=camera_list,
                    generate_depthmap=generate_depthmap,
                    override_lighting=override_lighting,
                    lighting_brightness=lighting_brightness,
                    include_blend=include_blend,
                    lights=lights_list,
                    color_management=color_management,
                )
            else:
                results = renderer.render_single_view(
                    generate_depthmap=generate_depthmap,
                    override_lighting=override_lighting,
                    lighting_brightness=lighting_brightness,
                    include_blend=include_blend,
                    color_management=color_management,
                )

            zip_path = renderer.create_zip(results)
            zip_filename = Path(zip_path).name

            response = {
                "success": True,
                "zip": f"/api/renders/{zip_filename}",
                "outputs": {},
            }
            for file_info in results["files"]:
                response["outputs"][file_info["type"]] = f"/api/renders/{file_info['filename']}"

            log_queue.put(("result", json.dumps(response)))

        except Exception as e:
            logger.exception("Render failed")
            log_queue.put(("error", json.dumps({"error": str(e)})))

    def generate():
        render_thread = threading.Thread(target=run_render, daemon=True)
        render_thread.start()

        while True:
            try:
                event_type, data = log_queue.get(timeout=1.0)
            except queue.Empty:
                if not render_thread.is_alive():
                    break
                yield f"event: ping\ndata: alive\n\n"
                continue

            yield f"event: {event_type}\ndata: {data}\n\n"

            if event_type in ("result", "error"):
                break

        render_thread.join(timeout=5)

    return Response(
        stream_with_context(generate()),
        content_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/render-splat-dataset", methods=["POST"])
def render_splat_dataset():
    """Render a Gaussian Splat training dataset via SSE."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body provided"}), 400

    scene_id = data.get("sceneId")
    if not scene_id:
        return jsonify({"error": "Missing sceneId"}), 400

    scene_path = UPLOAD_DIR / scene_id
    if not scene_path.exists():
        matches = list(UPLOAD_DIR.glob(f"*{scene_id}*"))
        if matches:
            scene_path = matches[0]
        else:
            return jsonify({"error": f"Scene file not found: {scene_id}"}), 404

    camera_list = data.get("cameras", [])
    if not camera_list:
        return jsonify({"error": "No cameras provided"}), 400

    preset = data.get("preset", "balanced")
    resolution = data.get("resolution", [None, None])
    samples = data.get("samples")
    generate_depth = bool(data.get("generateDepth", False))
    override_lighting = bool(data.get("overrideLighting", False))
    lighting_brightness = float(data.get("lightingBrightness", 1.5))
    lights_list = data.get("lights", [])
    hdr_format = data.get("hdrFormat", None)
    log_transform = bool(data.get("logTransform", False))
    color_management = data.get("colorManagement", "standard")

    logger.info(
        f"Splat dataset request: {scene_path.name}, preset={preset}, "
        f"cameras={len(camera_list)}, depth={generate_depth}, hdr={hdr_format}, log={log_transform}"
    )

    log_queue = queue.Queue()

    def run_render():
        try:
            from rendering.cycles_renderer import CyclesRenderer

            renderer = CyclesRenderer(
                output_dir=str(RENDER_DIR),
                log_queue=log_queue,
            )

            if not renderer.load_scene(str(scene_path)):
                log_queue.put(("error", json.dumps({"error": "Failed to load scene"})))
                return

            _resolve_backdrop(data, renderer)

            results = renderer.render_splat_dataset(
                cameras=camera_list,
                preset=preset,
                resolution_x=resolution[0] if resolution[0] else None,
                resolution_y=resolution[1] if resolution[1] else None,
                samples=samples,
                generate_depth=generate_depth,
                override_lighting=override_lighting,
                lighting_brightness=lighting_brightness,
                lights=lights_list,
                hdr_format=hdr_format,
                log_transform=log_transform,
                color_management=color_management,
            )

            zip_path = renderer.create_splat_zip(results)
            zip_filename = Path(zip_path).name

            response = {
                "success": True,
                "zip": f"/api/renders/{zip_filename}",
                "frameCount": len(camera_list),
                "preset": preset,
            }

            log_queue.put(("result", json.dumps(response)))

        except Exception as e:
            logger.exception("Splat dataset render failed")
            log_queue.put(("error", json.dumps({"error": str(e)})))

    def generate():
        render_thread = threading.Thread(target=run_render, daemon=True)
        render_thread.start()

        while True:
            try:
                event_type, data = log_queue.get(timeout=1.0)
            except queue.Empty:
                if not render_thread.is_alive():
                    break
                yield f"event: ping\ndata: alive\n\n"
                continue

            yield f"event: {event_type}\ndata: {data}\n\n"

            if event_type in ("result", "error"):
                break

        render_thread.join(timeout=5)

    return Response(
        stream_with_context(generate()),
        content_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.route("/api/renders/<path:filename>")
def serve_render(filename: str):
    """Serve a rendered image or zip archive (supports subdirectories)."""
    return send_from_directory(str(RENDER_DIR), filename)


@app.route("/api/backdrop/<filename>")
def serve_backdrop(filename: str):
    """Serve a backdrop image file (PNG or EXR)."""
    return send_from_directory(str(UPLOAD_DIR), filename)


@app.route("/api/export-blend", methods=["POST"])
def export_blend():
    """Export the complete scene as a .blend file with cameras and lights."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body provided"}), 400

    scene_id = data.get("sceneId")
    if not scene_id:
        return jsonify({"error": "Missing sceneId"}), 400

    scene_path = UPLOAD_DIR / scene_id
    if not scene_path.exists():
        matches = list(UPLOAD_DIR.glob(f"*{scene_id}*"))
        if matches:
            scene_path = matches[0]
        else:
            return jsonify({"error": f"Scene file not found: {scene_id}"}), 404

    camera_list = data.get("cameras", [])
    lights_list = data.get("lights", [])
    render_settings = data.get("renderSettings", {})
    override_lighting = bool(data.get("overrideLighting", False))
    lighting_brightness = float(data.get("lightingBrightness", 1.5))

    try:
        from rendering.cycles_renderer import CyclesRenderer

        renderer = CyclesRenderer(output_dir=str(RENDER_DIR))

        if not renderer.load_scene(str(scene_path)):
            return jsonify({"error": "Failed to load scene"}), 500

        if camera_list:
            renderer._persist_cameras(camera_list)

        renderer._ensure_lighting(override_lighting=override_lighting, brightness=lighting_brightness)

        if lights_list:
            renderer._add_user_lights(lights_list)

        width = int(render_settings.get("width", 1920))
        height = int(render_settings.get("height", 1080))
        samples = int(render_settings.get("samples", 128))
        import bpy
        scene = bpy.context.scene
        scene.render.resolution_x = width
        scene.render.resolution_y = height
        scene.cycles.samples = samples

        blend_filename = f"scene_export_{renderer.render_id}.blend"
        blend_path = str(RENDER_DIR / blend_filename)
        bpy.ops.wm.save_as_mainfile(filepath=blend_path)

        import zipfile
        zip_filename = f"scene_export_{renderer.render_id}.zip"
        zip_path = str(RENDER_DIR / zip_filename)
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.write(blend_path, blend_filename)

        return jsonify({
            "success": True,
            "zip": f"/api/renders/{zip_filename}",
            "cameras": len(camera_list),
            "lights": len(lights_list),
        })

    except Exception as e:
        logger.exception("Blend export failed")
        return jsonify({"error": str(e)}), 500


@app.route("/api/render-object-multiview", methods=["POST"])
def render_object_multiview():
    """Render multi-view images of individual objects via SSE."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body provided"}), 400

    scene_id = data.get("sceneId")
    if not scene_id:
        return jsonify({"error": "Missing sceneId"}), 400

    scene_path = UPLOAD_DIR / scene_id
    if not scene_path.exists():
        matches = list(UPLOAD_DIR.glob(f"*{scene_id}*"))
        if matches:
            scene_path = matches[0]
        else:
            return jsonify({"error": f"Scene file not found: {scene_id}"}), 404

    objects_list = data.get("objects", [])
    num_views = int(data.get("numViews", 16))
    resolution = int(data.get("resolution", 512))
    samples_val = int(data.get("samples", 32))
    generate_depth = bool(data.get("generateDepth", False))
    bg_color = data.get("bgColor", [1.0, 1.0, 1.0])
    transparent_bg = bool(data.get("transparentBg", False))

    log_queue = queue.Queue()

    def run_render():
        try:
            from rendering.cycles_renderer import CyclesRenderer
            renderer = CyclesRenderer(output_dir=str(RENDER_DIR), log_queue=log_queue)
            if not renderer.load_scene(str(scene_path)):
                log_queue.put(("error", json.dumps({"error": "Failed to load scene"})))
                return

            results = renderer.render_object_multiview(
                objects=objects_list, num_views=num_views,
                resolution=resolution, samples=samples_val,
                generate_depth=generate_depth,
                bg_color=bg_color, transparent_bg=transparent_bg,
            )
            zip_path = renderer.create_zip(results)
            zip_filename = Path(zip_path).name
            log_queue.put(("result", json.dumps({"success": True, "zip": f"/api/renders/{zip_filename}", "objects": len(objects_list)})))
        except Exception as e:
            logger.exception("Object multiview render failed")
            log_queue.put(("error", json.dumps({"error": str(e)})))

    def generate():
        render_thread = threading.Thread(target=run_render, daemon=True)
        render_thread.start()
        while True:
            try:
                event_type, evt_data = log_queue.get(timeout=1.0)
            except queue.Empty:
                if not render_thread.is_alive():
                    break
                yield f"event: ping\ndata: alive\n\n"
                continue
            yield f"event: {event_type}\ndata: {evt_data}\n\n"
            if event_type in ("result", "error"):
                break
        render_thread.join(timeout=5)

    return Response(stream_with_context(generate()), content_type="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/render-flythrough", methods=["POST"])
def render_flythrough():
    """Render interpolated camera flythrough via SSE."""
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body provided"}), 400

    scene_id = data.get("sceneId")
    if not scene_id:
        return jsonify({"error": "Missing sceneId"}), 400

    scene_path = UPLOAD_DIR / scene_id
    if not scene_path.exists():
        matches = list(UPLOAD_DIR.glob(f"*{scene_id}*"))
        if matches:
            scene_path = matches[0]
        else:
            return jsonify({"error": f"Scene file not found: {scene_id}"}), 404

    camera_list = data.get("cameras", [])
    total_frames = int(data.get("totalFrames", 300))
    fps_val = int(data.get("fps", 30))
    output_format = data.get("format", "png")
    generate_depth = bool(data.get("generateDepth", False))
    override_lighting = bool(data.get("overrideLighting", False))
    lighting_brightness = float(data.get("lightingBrightness", 1.5))
    lights_list = data.get("lights", [])
    color_management = data.get("colorManagement", "standard")
    width = int(data.get("width", 1920))
    height = int(data.get("height", 1080))
    samples_val = int(data.get("samples", 128))

    log_queue = queue.Queue()

    def run_render():
        try:
            from rendering.cycles_renderer import CyclesRenderer
            renderer = CyclesRenderer(
                output_dir=str(RENDER_DIR),
                render_resolution_x=width, render_resolution_y=height,
                rendering_samples=samples_val, log_queue=log_queue,
            )
            if not renderer.load_scene(str(scene_path)):
                log_queue.put(("error", json.dumps({"error": "Failed to load scene"})))
                return

            _resolve_backdrop(data, renderer)

            results = renderer.render_flythrough(
                cameras=camera_list, total_frames=total_frames, fps=fps_val,
                output_format=output_format, generate_depth=generate_depth,
                override_lighting=override_lighting, lighting_brightness=lighting_brightness,
                lights=lights_list, color_management=color_management,
            )
            zip_path = renderer.create_zip(results)
            zip_filename = Path(zip_path).name
            log_queue.put(("result", json.dumps({
                "success": True, "zip": f"/api/renders/{zip_filename}",
                "frames": total_frames, "fps": fps_val,
            })))
        except Exception as e:
            logger.exception("Flythrough render failed")
            log_queue.put(("error", json.dumps({"error": str(e)})))

    def generate():
        render_thread = threading.Thread(target=run_render, daemon=True)
        render_thread.start()
        while True:
            try:
                event_type, evt_data = log_queue.get(timeout=1.0)
            except queue.Empty:
                if not render_thread.is_alive():
                    break
                yield f"event: ping\ndata: alive\n\n"
                continue
            yield f"event: {event_type}\ndata: {evt_data}\n\n"
            if event_type in ("result", "error"):
                break
        render_thread.join(timeout=5)

    return Response(stream_with_context(generate()), content_type="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.route("/api/scene-analysis", methods=["POST"])
def scene_analysis():
    """Analyze the loaded scene and return mesh/PBR/topology report.

    Runs synchronously (bpy is not thread-safe -- concurrent scene loads cause SIGSEGV).
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body provided"}), 400

    scene_id = data.get("sceneId")
    if not scene_id:
        return jsonify({"error": "Missing sceneId"}), 400

    scene_path = UPLOAD_DIR / scene_id
    if not scene_path.exists():
        matches = list(UPLOAD_DIR.glob(f"*{scene_id}*"))
        if matches:
            scene_path = matches[0]
        else:
            return jsonify({"error": f"Scene file not found: {scene_id}"}), 404

    try:
        from rendering.cycles_renderer import CyclesRenderer
        from rendering.scene_analysis import analyze_scene

        renderer = CyclesRenderer(output_dir=str(RENDER_DIR))

        if not renderer.load_scene(str(scene_path)):
            return jsonify({"error": "Failed to load scene"}), 500

        logger.info("Starting scene analysis...")
        result = analyze_scene()
        return jsonify(result)

    except Exception as e:
        logger.exception("Scene analysis failed")
        return jsonify({"error": str(e)}), 500


@app.route("/api/generate-point-cloud", methods=["POST"])
def generate_point_cloud_endpoint():
    """Generate a curvature-weighted point cloud PLY from the loaded scene.

    Runs synchronously (bpy is not thread-safe).
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body provided"}), 400

    scene_id = data.get("sceneId")
    if not scene_id:
        return jsonify({"error": "Missing sceneId"}), 400

    scene_path = UPLOAD_DIR / scene_id
    if not scene_path.exists():
        matches = list(UPLOAD_DIR.glob(f"*{scene_id}*"))
        if matches:
            scene_path = matches[0]
        else:
            return jsonify({"error": f"Scene file not found: {scene_id}"}), 404

    target_points = int(data.get("targetPoints", 750_000))
    min_density_ratio = float(data.get("minDensityRatio", 0.12))
    curvature_gamma = float(data.get("curvatureGamma", 0.5))
    percentile_clip = float(data.get("percentileClip", 0.95))
    seed_val = data.get("seed", 42)
    seed = int(seed_val) if seed_val is not None else None
    sample_colors = bool(data.get("sampleColors", True))
    sample_normals = bool(data.get("sampleNormals", True))
    coord_system = data.get("coordSystem", "COLMAP")

    try:
        from rendering.cycles_renderer import CyclesRenderer
        from rendering.point_cloud_generator import generate_point_cloud

        render_id = str(uuid.uuid4())[:8]
        pc_output_dir = RENDER_DIR / f"pointcloud_{render_id}"
        pc_output_dir.mkdir(parents=True, exist_ok=True)

        renderer = CyclesRenderer(output_dir=str(RENDER_DIR))
        if not renderer.load_scene(str(scene_path)):
            return jsonify({"error": "Failed to load scene"}), 500

        logger.info(f"Generating point cloud: {target_points:,} points, seed={seed}")
        result = generate_point_cloud(
            target_points=target_points,
            min_density_ratio=min_density_ratio,
            curvature_gamma=curvature_gamma,
            percentile_clip=percentile_clip,
            seed=seed,
            sample_colors=sample_colors,
            sample_normals=sample_normals,
            coord_system=coord_system,
            output_dir=str(pc_output_dir),
        )

        ply_filename = Path(result["ply_path"]).name
        zip_filename = Path(result["zip_path"]).name

        return jsonify({
            "success": True,
            "ply": f"/api/renders/pointcloud_{render_id}/{ply_filename}",
            "zip": f"/api/renders/pointcloud_{render_id}/{zip_filename}",
            "plyPath": result["ply_path"],
            "stats": {
                "total_points": result["total_points"],
                "total_faces": result["total_faces"],
                "total_materials": result["total_materials"],
                "textured_materials": result["textured_materials"],
                "constant_materials": result["constant_materials"],
                "curvature_range": result["curvature_range"],
                "percentile_clip_value": result["percentile_clip_value"],
                "coord_system": result["coord_system"],
                "colors": result["colors"],
                "normals": result["normals"],
                "seed": result["seed"],
            },
        })

    except Exception as e:
        logger.exception("Point cloud generation failed")
        return jsonify({"error": str(e)}), 500


@app.route("/api/point-cloud-stats", methods=["POST"])
def point_cloud_stats_endpoint():
    """Compute curvature-density correlation stats for a generated PLY.

    Runs synchronously.
    """
    data = request.get_json()
    if not data:
        return jsonify({"error": "No JSON body provided"}), 400

    ply_path = data.get("plyPath")
    if not ply_path:
        return jsonify({"error": "Missing plyPath"}), 400

    if not Path(ply_path).exists():
        return jsonify({"error": f"PLY file not found: {ply_path}"}), 404

    stats_sample = int(data.get("statsSample", 80_000))
    knn_k = int(data.get("knnK", 12))

    try:
        from rendering.point_cloud_generator import compute_point_cloud_stats

        logger.info(f"Computing point cloud stats: {ply_path}")
        result = compute_point_cloud_stats(
            ply_path=ply_path,
            stats_sample=stats_sample,
            knn_k=knn_k,
        )

        result["success"] = True
        return jsonify(result)

    except Exception as e:
        logger.exception("Point cloud stats computation failed")
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
