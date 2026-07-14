# Multi-stage production Dockerfile
# Stage 1: Build frontend
FROM node:20-slim AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install
COPY frontend/ .
RUN npm run build

# Stage 2: Python backend serving the built frontend
FROM --platform=linux/amd64 python:3.11-slim

WORKDIR /app

# Install system dependencies required by bpy/Blender (GPU rendering via Cycles)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libxi6 \
    libxxf86vm1 \
    libxfixes3 \
    libxrender1 \
    libgl1 \
    libglx-mesa0 \
    libegl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxkbcommon0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Ensure Draco decompression library is accessible for bpy's glTF importer
RUN DRACO_LIB=$(find /usr/local/lib -name "libextern_draco.so" 2>/dev/null | head -1) && \
    if [ -n "$DRACO_LIB" ]; then \
        mkdir -p /app/4.3/python/lib/python3.11/site-packages && \
        cp "$DRACO_LIB" /app/4.3/python/lib/python3.11/site-packages/libextern_draco.so; \
    else \
        BPY_PATH=$(python -c "import bpy, os; print(os.path.dirname(bpy.__file__))") && \
        DRACO_LIB=$(find "$BPY_PATH" -name "libextern_draco.so" 2>/dev/null | head -1) && \
        if [ -n "$DRACO_LIB" ]; then \
            mkdir -p /app/4.3/python/lib/python3.11/site-packages && \
            cp "$DRACO_LIB" /app/4.3/python/lib/python3.11/site-packages/libextern_draco.so; \
        fi; \
    fi

COPY backend/ .
COPY --from=frontend-build /app/frontend/dist ./static

ENV UPLOAD_DIR=/tmp/room-connect-uploads
ENV STATIC_DIR=./static

EXPOSE 8080

CMD ["gunicorn", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "600", "--worker-class", "gthread", "--threads", "4", "app:app"]
