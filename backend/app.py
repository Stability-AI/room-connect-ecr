"""Flask backend for room-connect: serves the React frontend and handles file uploads."""

import os
import uuid
from pathlib import Path

from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

STATIC_DIR = os.environ.get("STATIC_DIR", "../frontend/dist")
app = Flask(__name__, static_folder=STATIC_DIR, static_url_path="")
CORS(app)

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", "/tmp/room-connect-uploads"))
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".glb", ".gltf"}


def allowed_file(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_EXTENSIONS


@app.route("/")
def serve_frontend():
    return send_from_directory(app.static_folder, "index.html")


@app.route("/api/upload", methods=["POST"])
def upload_scene():
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["file"]
    if not file.filename or not allowed_file(file.filename):
        return jsonify({"error": "Invalid file type. Only .glb/.gltf allowed"}), 400

    filename = secure_filename(file.filename)
    file_id = str(uuid.uuid4())
    save_path = UPLOAD_DIR / f"{file_id}_{filename}"
    file.save(str(save_path))

    return jsonify({
        "id": file_id,
        "filename": filename,
        "url": f"/api/scenes/{file_id}_{filename}",
    })


@app.route("/api/scenes/<filename>")
def serve_scene(filename: str):
    return send_from_directory(str(UPLOAD_DIR), filename)


@app.route("/api/health")
def health():
    return jsonify({"status": "ok"})


@app.route("/<path:path>")
def catch_all(path):
    file_path = Path(app.static_folder) / path
    if file_path.exists():
        return send_from_directory(app.static_folder, path)
    return send_from_directory(app.static_folder, "index.html")


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
