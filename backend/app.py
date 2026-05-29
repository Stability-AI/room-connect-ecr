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


def allowed_file(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


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
    camera_list = data.get("cameras", [])

    logger.info(
        f"Render request: {scene_path.name}, {width}x{height}, {samples} samples, "
        f"depth={generate_depthmap}, override_lighting={override_lighting}"
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

            if camera_list:
                results = renderer.render_all_views(
                    cameras=camera_list,
                    generate_depthmap=generate_depthmap,
                    override_lighting=override_lighting,
                    lighting_brightness=lighting_brightness,
                    include_blend=include_blend,
                )
            else:
                results = renderer.render_single_view(
                    generate_depthmap=generate_depthmap,
                    override_lighting=override_lighting,
                    lighting_brightness=lighting_brightness,
                    include_blend=include_blend,
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


@app.route("/api/renders/<filename>")
def serve_render(filename: str):
    """Serve a rendered image or zip archive."""
    return send_from_directory(str(RENDER_DIR), filename)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
